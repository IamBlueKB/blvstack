import type { APIRoute } from 'astro';
import { assertBusiness } from '../../../../lib/janet/clearear/expenses';
import {
  createExpense, updateExpense, deleteExpense,
  createRecurring, setRecurringActive,
  createMileage, deleteMileage,
} from '../../../../lib/janet/clearear/expenses';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const admin = (locals as any).adminEmail;
  if (!admin) return json({ error: 'Unauthorized' }, 401);
  let b: any;
  try { b = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  try {
    switch (b.action) {
      case 'log_expense': {
        const res = await createExpense({
          business: assertBusiness(b.business),
          spent_at: b.spent_at, vendor: b.vendor, amount: Number(b.amount), category_key: b.category_key, method: b.method,
          reference: b.reference, notes: b.notes,
          deductible: b.deductible !== false, deductible_pct: b.deductible_pct, is_owner_draw: b.is_owner_draw === true,
          contractor_contact_id: b.contractor_contact_id || null, receipt_url: b.receipt_url || null, created_by: admin,
        });
        return json({ ok: true, ...res });
      }
      case 'update_expense': {
        if (!b.id) return json({ error: 'id required' }, 400);
        const exp = await updateExpense(b.id, b);
        return json({ ok: true, expense: exp });
      }
      case 'delete_expense': {
        if (!b.id) return json({ error: 'id required' }, 400);
        return json({ ok: true, ...(await deleteExpense(b.id)) });
      }
      case 'add_recurring': {
        const r = await createRecurring({ business: assertBusiness(b.business), vendor: b.vendor, amount: Number(b.amount), category_key: b.category_key, method: b.method, day_of_month: Number(b.day_of_month), notes: b.notes });
        return json({ ok: true, recurring: r });
      }
      case 'toggle_recurring': {
        if (!b.id) return json({ error: 'id required' }, 400);
        await setRecurringActive(b.id, b.active === true);
        return json({ ok: true });
      }
      case 'log_mileage': {
        const m = await createMileage({ business: assertBusiness(b.business), drove_on: b.drove_on, purpose: b.purpose, miles: Number(b.miles), rate_cents: Math.round(Number(b.rate_cents)), start_location: b.start_location, end_location: b.end_location, notes: b.notes });
        return json({ ok: true, mileage: m });
      }
      case 'delete_mileage': {
        if (!b.id) return json({ error: 'id required' }, 400);
        return json({ ok: true, ...(await deleteMileage(b.id)) });
      }
      default:
        return json({ error: `Unknown action: ${b.action}` }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
