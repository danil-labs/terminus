//! Equivalentes Windows de la propiedad y el acceso exclusivo que Unix exige con uid y modo.
//! La DACL sólo puede conceder acceso al usuario del proceso, SYSTEM y Administrators;
//! cualquier otra entrada que conceda acceso, o que no se sepa interpretar, rechaza el archivo.
use std::{
    fs::{File, OpenOptions},
    os::windows::{fs::OpenOptionsExt, io::AsRawHandle},
    path::Path,
    ptr,
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, LocalFree, ERROR_SUCCESS, HANDLE},
    Security::{
        AddAccessAllowedAceEx,
        Authorization::{GetSecurityInfo, SE_FILE_OBJECT},
        EqualSid, GetAce, GetLengthSid, GetTokenInformation, InitializeAcl,
        InitializeSecurityDescriptor, IsValidSid, IsWellKnownSid, SetKernelObjectSecurity,
        SetSecurityDescriptorControl, SetSecurityDescriptorDacl, TokenUser,
        WinBuiltinAdministratorsSid, WinCreatorOwnerSid, WinLocalSystemSid, ACCESS_ALLOWED_ACE,
        ACE_HEADER, ACL, ACL_REVISION, CONTAINER_INHERIT_ACE, DACL_SECURITY_INFORMATION,
        INHERIT_ONLY_ACE, OBJECT_INHERIT_ACE, OWNER_SECURITY_INFORMATION,
        PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID, SECURITY_DESCRIPTOR,
        SE_DACL_PROTECTED, TOKEN_QUERY, TOKEN_USER,
    },
    Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_ALL_ACCESS,
        FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS,
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES, READ_CONTROL, WRITE_DAC,
    },
    System::Threading::{GetCurrentProcess, OpenProcessToken},
};

const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;
const SECURITY_DESCRIPTOR_REVISION: u32 = 1;
const ACCESS_DENIED_ACE_TYPE: u8 = 1;

pub struct Identity {
    pub device: u64,
    pub inode: u64,
    pub links: u32,
    pub directory: bool,
}

pub fn open(path: &Path) -> std::io::Result<File> {
    OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)
}

pub fn identity(file: &File) -> Option<Identity> {
    let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    if unsafe { GetFileInformationByHandle(file.as_raw_handle() as HANDLE, &mut info) } == 0
        || info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
    {
        return None;
    }
    Some(Identity {
        device: info.dwVolumeSerialNumber as u64,
        inode: (info.nFileIndexHigh as u64) << 32 | info.nFileIndexLow as u64,
        links: info.nNumberOfLinks,
        directory: info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0,
    })
}

pub fn owned_exclusively(file: &File) -> bool {
    let Some(user) = CurrentUser::query() else {
        return false;
    };
    let mut owner: PSID = ptr::null_mut();
    let mut dacl: *mut ACL = ptr::null_mut();
    let mut descriptor: PSECURITY_DESCRIPTOR = ptr::null_mut();
    let status = unsafe {
        GetSecurityInfo(
            file.as_raw_handle() as HANDLE,
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            &mut owner,
            ptr::null_mut(),
            &mut dacl,
            ptr::null_mut(),
            &mut descriptor,
        )
    };
    if status != ERROR_SUCCESS || descriptor.is_null() {
        return false;
    }
    let exclusive = !owner.is_null()
        && unsafe { IsValidSid(owner) } != 0
        && unsafe { EqualSid(owner, user.sid()) } != 0
        && !dacl.is_null()
        && unsafe { grants_only_to(dacl, user.sid()) };
    unsafe { LocalFree(descriptor) };
    exclusive
}

/// DACL protegida con una sola entrada, el usuario: quita lo que heredaba del perfil.
/// No se propaga a lo que ya existe dentro; lo que se cree después hereda solo al usuario.
pub fn make_private(path: &Path) -> std::io::Result<()> {
    let file = OpenOptions::new()
        .access_mode(READ_CONTROL | WRITE_DAC | FILE_READ_ATTRIBUTES)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)?;
    let opened = identity(&file).ok_or_else(|| std::io::Error::other("reparse point"))?;
    let user = CurrentUser::query().ok_or_else(std::io::Error::last_os_error)?;
    let sid = user.sid();
    let size = std::mem::size_of::<ACL>() + std::mem::size_of::<ACCESS_ALLOWED_ACE>()
        - std::mem::size_of::<u32>()
        + unsafe { GetLengthSid(sid) } as usize;
    let mut acl = vec![0u32; size.div_ceil(4)];
    let acl_ptr = acl.as_mut_ptr() as *mut ACL;
    let flags = if opened.directory {
        OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE
    } else {
        0
    };
    let mut descriptor: SECURITY_DESCRIPTOR = unsafe { std::mem::zeroed() };
    let descriptor_ptr = ptr::addr_of_mut!(descriptor) as PSECURITY_DESCRIPTOR;
    let applied = unsafe {
        InitializeAcl(acl_ptr, (acl.len() * 4) as u32, ACL_REVISION) != 0
            && AddAccessAllowedAceEx(acl_ptr, ACL_REVISION, flags, FILE_ALL_ACCESS, sid) != 0
            && InitializeSecurityDescriptor(descriptor_ptr, SECURITY_DESCRIPTOR_REVISION) != 0
            && SetSecurityDescriptorDacl(descriptor_ptr, 1, acl_ptr, 0) != 0
            && SetSecurityDescriptorControl(descriptor_ptr, SE_DACL_PROTECTED, SE_DACL_PROTECTED)
                != 0
            && SetKernelObjectSecurity(
                file.as_raw_handle() as HANDLE,
                DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                descriptor_ptr,
            ) != 0
    };
    if !applied {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

unsafe fn grants_only_to(dacl: *const ACL, user: PSID) -> bool {
    for index in 0..(*dacl).AceCount as u32 {
        let mut ace: *mut core::ffi::c_void = ptr::null_mut();
        if GetAce(dacl, index, &mut ace) == 0 {
            return false;
        }
        let header = &*(ace as *const ACE_HEADER);
        match header.AceType {
            ACCESS_DENIED_ACE_TYPE => {}
            ACCESS_ALLOWED_ACE_TYPE => {
                let allowed = ace as *const ACCESS_ALLOWED_ACE;
                let sid = ptr::addr_of!((*allowed).SidStart) as PSID;
                let trusted = EqualSid(sid, user) != 0
                    || IsWellKnownSid(sid, WinLocalSystemSid) != 0
                    || IsWellKnownSid(sid, WinBuiltinAdministratorsSid) != 0
                    || (header.AceFlags as u32 & INHERIT_ONLY_ACE != 0
                        && IsWellKnownSid(sid, WinCreatorOwnerSid) != 0);
                if !trusted && (*allowed).Mask != 0 {
                    return false;
                }
            }
            _ => return false,
        }
    }
    true
}

struct CurrentUser(Vec<u64>);
impl CurrentUser {
    fn query() -> Option<Self> {
        let mut token: HANDLE = ptr::null_mut();
        if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
            return None;
        }
        let mut length = 0u32;
        unsafe { GetTokenInformation(token, TokenUser, ptr::null_mut(), 0, &mut length) };
        let mut buffer = vec![0u64; (length as usize).div_ceil(8).max(1)];
        let read = unsafe {
            GetTokenInformation(
                token,
                TokenUser,
                buffer.as_mut_ptr().cast(),
                (buffer.len() * 8) as u32,
                &mut length,
            )
        };
        unsafe { CloseHandle(token) };
        (read != 0).then_some(Self(buffer))
    }
    fn sid(&self) -> PSID {
        unsafe { (*(self.0.as_ptr() as *const TOKEN_USER)).User.Sid }
    }
}
