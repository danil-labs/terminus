import { For, Show } from 'solid-js';
import Inbox from 'lucide-solid/icons/inbox';
import Megaphone from 'lucide-solid/icons/megaphone';
import Bot from 'lucide-solid/icons/bot';
import Plug from 'lucide-solid/icons/plug';
import SlidersHorizontal from 'lucide-solid/icons/sliders-horizontal';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '../../ui/sidebar';
import { t } from '../../lib/i18n';

export type AttentionMenuProps = { entries: readonly {id:string;title:string}[]; active:string|null; collapsed:boolean; onOpen(id:string):void };
export function AttentionMenu(props: AttentionMenuProps) {
 return <For each={props.entries}>{feature=><SidebarMenuItem><SidebarMenuButton data-attention-feature={feature.id} isActive={props.active===feature.id} aria-label={feature.title} onClick={()=>props.onOpen(feature.id)}>
 {feature.id==='inbox'?<Inbox size={14}/>:feature.id==='broadcasts'?<Megaphone size={14}/>:feature.id==='agents'?<Bot size={14}/>:<Plug size={14}/>}
 <Show when={!props.collapsed}><span>{feature.title}</span></Show>
 </SidebarMenuButton></SidebarMenuItem>}</For>;
}
export function PersonalizeMenu(props:{collapsed:boolean;onOpen():void;onTrigger?(trigger:HTMLButtonElement):void}) {
 return <SidebarMenu><SidebarMenuItem><SidebarMenuButton aria-label={t("attention.personalize")} onClick={event=>{props.onTrigger?.(event.currentTarget);props.onOpen();}}><SlidersHorizontal size={14}/><Show when={!props.collapsed}><span>{t("attention.personalize")}</span></Show></SidebarMenuButton></SidebarMenuItem></SidebarMenu>;
}
