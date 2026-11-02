// common.ts — the strings every mobile app shares (sign-in, navigation, greetings, language). Each English value is the
// exact text the screens showed before the key existed (Constitution 6 §97; BUILD_PLAN Phase 13 E — nothing English
// changes). App-specific strings live in apps/<app>/src/i18n/catalog.ts.
type Catalog = Record<string, string>;

export const COMMON_EN: Catalog = {
  'common.welcomeBack': 'Welcome Back',
  'common.password': 'Password',
  'common.forgotPassword': 'Forgot Password?',
  'common.backToSignIn': 'Back to sign in',
  'common.back': 'Back',
  'common.emailOrMobile': 'Email or Mobile Number',
  'common.salonCode': 'Salon code',
  'common.mobileNumber': 'Mobile number',
  'common.verificationCode': 'Verification code',
  'common.dataProtected': 'Your data is protected with enterprise-grade security.',
  'common.tagline': 'SMARTER SALON. STRONGER BUSINESS.',
  'nav.home': 'Home', 'nav.schedule': 'Schedule', 'nav.tickets': 'Tickets', 'nav.earnings': 'Earnings', 'nav.more': 'More',
  'nav.live': 'Live', 'nav.approvals': 'Approvals', 'nav.reports': 'Reports',
  'nav.appointments': 'Appointments', 'nav.deals': 'Deals', 'nav.wallet': 'Wallet', 'nav.profile': 'Profile',
  'nav.checkout': 'Checkout', 'nav.history': 'History', 'nav.account': 'Account',
  'greeting.morning': 'Good morning', 'greeting.afternoon': 'Good afternoon', 'greeting.evening': 'Good evening',
  'language.title': 'Language', 'language.en': 'English', 'language.vi': 'Tiếng Việt',
};

export const COMMON_VI: Catalog = {
  'common.welcomeBack': 'Chào mừng trở lại',
  'common.password': 'Mật khẩu',
  'common.forgotPassword': 'Quên mật khẩu?',
  'common.backToSignIn': 'Quay lại đăng nhập',
  'common.back': 'Quay lại',
  'common.emailOrMobile': 'Email hoặc số điện thoại',
  'common.salonCode': 'Mã tiệm',
  'common.mobileNumber': 'Số điện thoại',
  'common.verificationCode': 'Mã xác minh',
  'common.dataProtected': 'Dữ liệu của bạn được bảo vệ bằng bảo mật cấp doanh nghiệp.',
  'common.tagline': 'TIỆM THÔNG MINH HƠN. KINH DOANH VỮNG MẠNH HƠN.',
  'nav.home': 'Trang chủ', 'nav.schedule': 'Lịch làm', 'nav.tickets': 'Phiếu', 'nav.earnings': 'Thu nhập', 'nav.more': 'Thêm',
  'nav.live': 'Trực tiếp', 'nav.approvals': 'Phê duyệt', 'nav.reports': 'Báo cáo',
  'nav.appointments': 'Lịch hẹn', 'nav.deals': 'Ưu đãi', 'nav.wallet': 'Ví', 'nav.profile': 'Hồ sơ',
  'nav.checkout': 'Thanh toán', 'nav.history': 'Lịch sử', 'nav.account': 'Tài khoản',
  'greeting.morning': 'Chào buổi sáng', 'greeting.afternoon': 'Chào buổi chiều', 'greeting.evening': 'Chào buổi tối',
  'language.title': 'Ngôn ngữ', 'language.en': 'English', 'language.vi': 'Tiếng Việt',
};
