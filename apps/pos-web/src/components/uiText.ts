// uiText.ts — English + Vietnamese POS mandate (WP-C4): the shared @aipowersalon/ui components have no i18n; the POS registers
// its translated text with them ONCE (imported by main.tsx and the test setup). The resolvers run at render, so an instant
// language switch re-labels them in place.
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { setAvatarPreviewTitle } from '@aipowersalon/ui';

setAvatarPreviewTitle((name) => t('admin.avatar.previewTitle', { name }));
