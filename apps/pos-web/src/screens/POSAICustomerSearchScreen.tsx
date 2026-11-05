// POSAICustomerSearchScreen.tsx — AI Center → AI Customer Profile → Customer Search (§45). Server-side search
// (min length, tenant + permission filtered by the API), then the embeddable read-only AI Profile panel for the
// selected customer. No unbounded "return everyone" behaviour; nothing mutates.
import { useState } from 'react';
import { CustomerLookup } from './aiCustomerProfileCommon';
import { AICustomerProfilePanel } from './AICustomerProfilePanel';
import { t } from '@aipowersalon/mobile-sdk/i18n';

export function POSAICustomerSearchScreen() {
  const [selected, setSelected] = useState<any>(null);
  const name = (c: any) => c?.displayName || c?.fullName || [c?.firstName, c?.lastName].filter(Boolean).join(' ');

  return (
    <div className="work">
      <div className="vh flex flex-col sm:flex-row gap-3 justify-between">
        <div>
          <h1>{t('pos.customer_search')}</h1>
        <div className="sub mb-3">{t('pos.find_a_customer_and_open_their_1vdb')}</div>
        </div></div>

      {!selected ? <CustomerLookup onPick={setSelected} placeholder={t('pos.search_by_name_phone_email_or_y6t9')} /> : (
        <section className="panel" style={{ marginTop: 12, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>{name(selected)}</strong>
            <button className="btn w-fit whitespace-nowrap"  onClick={() => setSelected(null)}>{t('pos.new_search')}</button>
          </div>
          <AICustomerProfilePanel customerId={selected.customerId || selected.id} />
        </section>
      )}
    </div>
  );
}
