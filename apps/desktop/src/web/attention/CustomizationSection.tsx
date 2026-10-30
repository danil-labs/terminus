import { Show } from 'solid-js';
import { t } from '../../lib/i18n';
import { Button } from '../../ui/Button';
import { FeatureCatalog, type FeatureEntry } from './FeatureCatalog';

export type CustomizationSectionProps={temporary:boolean;writable:boolean;demo:boolean;entries:readonly FeatureEntry[];onToggle(id:string):void};
export function CustomizationSection(props:CustomizationSectionProps) {
 return <div class="grid gap-1.5 px-2 pb-1">
 <Show when={!props.writable}><p role="alert" class="m-0 text-xs text-warning-strong">{t("attention.future")}</p></Show>
 <FeatureCatalog entries={props.entries} onToggle={props.onToggle}/>
 <Show when={props.demo}><Button as="a" size="sm" variant="ghost" class="justify-self-start" href={`${import.meta.env.BASE_URL}inbox`}>{t("attention.leave_demo")}</Button></Show>
 </div>;
}
