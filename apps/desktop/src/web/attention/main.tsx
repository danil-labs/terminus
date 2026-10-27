import { render } from 'solid-js/web';
import { aplicarLengua } from '../../lib/i18n';
import { seguirElTema } from '../../lib/theme';
import '../phrases';
import '../../styles/global.css';
import { Attention } from './Attention';

export function startAttention(settings: { supabaseUrl: string; supabaseKey: string; login: string }) {
  aplicarLengua();
  seguirElTema();
  render(() => <Attention settings={settings} />, document.getElementById('root') as HTMLElement);
}
