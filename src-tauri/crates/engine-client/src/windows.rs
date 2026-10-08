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
        Authorization::{GetSecurityInfo, SE_FILE_OBJECT},
        EqualSid, GetAce, GetTokenInformation, IsValidSid, IsWellKnownSid, TokenUser,
        WinBuiltinAdministratorsSid, WinCreatorOwnerSid, WinLocalSystemSid, ACCESS_ALLOWED_ACE,
        ACE_HEADER, ACL, DACL_SECURITY_INFORMATION, INHERIT_ONLY_ACE, OWNER_SECURITY_INFORMATION,
        PSECURITY_DESCRIPTOR, PSID, TOKEN_QUERY, TOKEN_USER,
    },
    Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_DIRECTORY,
        FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
    },
    System::Threading::{GetCurrentProcess, OpenProcessToken},
};

const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;
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
