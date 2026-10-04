// Razorpay Checkout, loaded on demand.
//
// UPI is listed first and preselected deliberately: it carries zero MDR for the
// merchant (RBI-mandated), where cards cost ~2% — on a ₹300 advance against a
// thin platform margin, that difference is material. It is also what most
// Indian riders actually reach for.

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

let loader = null;

/** Load checkout.js once and reuse it. */
function loadCheckout() {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = CHECKOUT_SRC;
    el.async = true;
    el.onload = () => (window.Razorpay ? resolve(window.Razorpay) : reject(new Error('Checkout failed to load')));
    el.onerror = () => {
      loader = null; // let a later attempt retry
      reject(new Error('Could not reach the payment gateway'));
    };
    document.head.appendChild(el);
  });
  return loader;
}

/**
 * Open Checkout and resolve with the gateway's response.
 *
 * Rejects with `{ dismissed: true }` when the rider closes the sheet, so the
 * caller can stay quiet instead of showing a failure they caused themselves.
 */
export async function openCheckout({ keyId, order, prefill = {}, name = 'YatraCab', description }) {
  const Razorpay = await loadCheckout();

  return new Promise((resolve, reject) => {
    const rp = new Razorpay({
      key: keyId,
      order_id: order.id,
      amount: order.amount,
      currency: order.currency || 'INR',
      name,
      description,
      theme: { color: '#c2410c' }, // terracotta, matching the rider app
      prefill: { name: prefill.name || '', contact: prefill.phone || '', email: prefill.email || '' },
      // UPI first, and expanded on open.
      config: {
        display: {
          blocks: {
            upi: { name: 'Pay by UPI', instruments: [{ method: 'upi' }] },
            rest: { name: 'Other methods', instruments: [{ method: 'card' }, { method: 'netbanking' }, { method: 'wallet' }] },
          },
          sequence: ['block.upi', 'block.rest'],
          preferences: { show_default_blocks: false },
        },
      },
      handler: (response) => resolve(response),
      modal: {
        ondismiss: () => reject(Object.assign(new Error('Payment cancelled'), { dismissed: true })),
        confirm_close: true, // UPI round-trips leave the tab; don't lose it to a stray tap
      },
    });

    rp.on('payment.failed', (e) =>
      reject(new Error(e?.error?.description || 'Payment failed — no money was taken'))
    );
    rp.open();
  });
}
