import { t } from '@aipowersalon/mobile-sdk/i18n';
// ComingSoon — honest placeholder for POS screens not yet converted from HTML to React.
// Shows the screen name + a clear "not yet wired" badge; it never renders fabricated data.
export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="work">
      <div className="soon">
        <div className="badge">{t('pos.react_conversion_pending')}</div>
        <h1>{title}</h1>
        <p className="muted">{t('pos.this_screen_s_html_hasn_t_bmtn')}</p>
      </div>
    </div>
  );
}
