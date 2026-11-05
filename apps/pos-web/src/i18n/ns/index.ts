// ns/index.ts — every POS namespace catalogue (Vietnamese POS build plan §2 rule 1). One owner per namespace file; this
// list is the only place they are registered (i18n/index.ts). Keys are '<ns>.<area>.<item>' so namespaces never collide.
import { NAV_EN } from './nav.en';
import { NAV_VI } from './nav.vi';
import { OPS_EN } from './ops.en';
import { OPS_VI } from './ops.vi';
import { PEOPLE_EN } from './people.en';
import { PEOPLE_VI } from './people.vi';
import { GROWTH_EN } from './growth.en';
import { GROWTH_VI } from './growth.vi';
import { ADMIN_EN } from './admin.en';
import { ADMIN_VI } from './admin.vi';
import { GLOSSARY_EN } from './glossary.en';
import { GLOSSARY_VI } from './glossary.vi';
import { STATUS_EN } from './status.en';
import { STATUS_VI } from './status.vi';
import { ERRORS_EN } from './errors.en';
import { ERRORS_VI } from './errors.vi';
import { PAYMENT_EN } from './payment.en';
import { PAYMENT_VI } from './payment.vi';
import { SEARCH_EN } from './search.en';
import { SEARCH_VI } from './search.vi';
import { COMMS_EN } from './comms.en';
import { COMMS_VI } from './comms.vi';
import { SRV_EN } from './srv.en';
import { SRV_VI } from './srv.vi';
import { AUDIT_EN } from './audit.en';
import { AUDIT_VI } from './audit.vi';

export const NAMESPACES_EN: Record<string, string>[] = [NAV_EN, OPS_EN, PEOPLE_EN, GROWTH_EN, ADMIN_EN, GLOSSARY_EN, STATUS_EN, ERRORS_EN, PAYMENT_EN, SEARCH_EN, COMMS_EN, SRV_EN, AUDIT_EN];
export const NAMESPACES_VI: Record<string, string>[] = [NAV_VI, OPS_VI, PEOPLE_VI, GROWTH_VI, ADMIN_VI, GLOSSARY_VI, STATUS_VI, ERRORS_VI, PAYMENT_VI, SEARCH_VI, COMMS_VI, SRV_VI, AUDIT_VI];
