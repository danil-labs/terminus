import { Show } from 'solid-js';
import { t } from '../../lib/i18n';
import { Dialog, DialogContent, DialogTitle } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { FeatureCatalog, type FeatureEntry } from './FeatureCatalog';

export type CustomizationDialogProps={restoreFocus?():void;open:boolean;onOpenChange(open:boolean):void;temporary:boolean;writable:boolean;demo:boolean;entries:readonly FeatureEntry[];onToggle(id:string):void};
export function CustomizationDialog(props:CustomizationDialogProps) {
 return <Dialog open={props.open} onOpenChange={props.onOpenChange}><DialogContent onCloseAutoFocus={event=>{event.preventDefault();props.restoreFocus?.();}} class="flex max-h-[80dvh] max-w-2xl flex-col gap-3 overflow-y-auto">
 <DialogTitle class="text-base font-semibold">{t("attention.personalize")}</DialogTitle>
 <p class="m-0 text-xs text-neutral-500">{props.temporary?t("attention.memory"):t("attention.local")}</p>
 <Button as="a" variant="ghost" class="self-start" href={`${import.meta.env.BASE_URL}inbox${props.demo?'':'?demo=1'}`}>{props.demo?t("attention.leave_demo"):t("attention.demo_mode")}</Button>
 <Show when={!props.writable}><p role="alert" class="text-sm text-warning-strong">{t("attention.future")}</p></Show>
 <FeatureCatalog entries={props.entries} onToggle={props.onToggle}/>
 <Button variant="secondary" class="self-end" onClick={()=>props.onOpenChange(false)}>{t("attention.close")}</Button>
 </DialogContent></Dialog>;
}
