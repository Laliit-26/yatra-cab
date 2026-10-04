import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, CardBody, Button, Badge, Modal, Field, Input, Select, Table, PageHeader,
  QueryBoundary, LoadingScreen, EmptyState, toast, inr, formatDateTime,
} from '@yatracab/ui';
import { Ticket, Plus, Power, Pencil, Users } from 'lucide-react';
import { api } from '../api.js';

const blank = {
  code: '', description: '', type: 'flat', value: 100,
  maxDiscount: 0, minFare: 0, totalCoupons: 100, perUserLimit: 1, validUntil: '',
};

const asDateInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

export default function Coupons() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(null); // null | 'new' | coupon
  const [form, setForm] = useState(blank);
  const [detailId, setDetailId] = useState(null);
  const [q, setQ] = useState('');

  const query = useQuery({
    queryKey: ['admin-coupons', q],
    queryFn: () => api.get(`/admin/coupons${q ? `?q=${encodeURIComponent(q)}` : ''}`).then((r) => r.coupons),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-coupons'] });

  const openNew = () => { setForm(blank); setEditing('new'); };
  const openEdit = (c) => {
    setForm({
      code: c.code, description: c.description || '', type: c.type, value: c.value,
      maxDiscount: c.maxDiscount || 0, minFare: c.minFare || 0,
      totalCoupons: c.totalCoupons, perUserLimit: c.perUserLimit, validUntil: asDateInput(c.validUntil),
    });
    setEditing(c);
  };

  const save = useMutation({
    mutationFn: () => {
      const body = {
        description: form.description,
        type: form.type,
        value: Number(form.value),
        maxDiscount: Number(form.maxDiscount) || 0,
        minFare: Number(form.minFare) || 0,
        totalCoupons: Number(form.totalCoupons),
        perUserLimit: Number(form.perUserLimit),
        validUntil: form.validUntil || undefined,
      };
      // The code is what riders were given, so it is set once at creation.
      return editing === 'new'
        ? api.post('/admin/coupons', { ...body, code: form.code.toUpperCase().trim() })
        : api.patch(`/admin/coupons/${editing._id}`, body);
    },
    onSuccess: () => {
      toast.success(editing === 'new' ? 'Coupon created' : 'Coupon updated');
      setEditing(null);
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const toggle = useMutation({
    mutationFn: (c) => (c.active ? api.del(`/admin/coupons/${c._id}`) : api.patch(`/admin/coupons/${c._id}`, { active: true })),
    onSuccess: () => { toast.success('Updated'); invalidate(); },
    onError: (err) => toast.error(err.message),
  });

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const columns = [
    {
      key: 'code',
      header: 'Code',
      render: (c) => (
        <div>
          <p className="font-semibold text-ink-900">{c.code}</p>
          {c.description && <p className="text-xs text-ink-500">{c.description}</p>}
        </div>
      ),
    },
    {
      key: 'discount',
      header: 'Discount',
      render: (c) => (
        <div>
          <p className="font-medium text-ink-800">{c.type === 'percent' ? `${c.value}% off` : `${inr(c.value)} off`}</p>
          <p className="text-xs text-ink-400">
            {c.type === 'percent' && c.maxDiscount > 0 ? `max ${inr(c.maxDiscount)}` : ''}
            {c.minFare > 0 ? `${c.type === 'percent' && c.maxDiscount > 0 ? ' · ' : ''}fares over ${inr(c.minFare)}` : ''}
            {!c.maxDiscount && !c.minFare ? 'no conditions' : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'used',
      header: 'Redeemed',
      render: (c) => {
        const pct = Math.min(100, Math.round((c.usedCount / c.totalCoupons) * 100));
        return (
          <div className="min-w-[110px]">
            <p className="text-sm"><span className="font-semibold text-ink-900">{c.usedCount}</span><span className="text-ink-400"> / {c.totalCoupons}</span></p>
            <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-ink-200">
              <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
            </span>
          </div>
        );
      },
    },
    { key: 'perUserLimit', header: 'Per rider', render: (c) => c.perUserLimit },
    { key: 'validUntil', header: 'Expires', render: (c) => (c.validUntil ? new Date(c.validUntil).toLocaleDateString() : '—') },
    {
      key: 'status',
      header: 'Status',
      render: (c) => (
        <Badge tone={!c.active ? 'neutral' : c.usedCount >= c.totalCoupons ? 'warning' : 'success'}>
          {!c.active ? 'Inactive' : c.usedCount >= c.totalCoupons ? 'Fully claimed' : 'Active'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (c) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" icon={Users} onClick={(e) => { e.stopPropagation(); setDetailId(c._id); }}>Uses</Button>
          <Button size="sm" variant="ghost" icon={Pencil} onClick={(e) => { e.stopPropagation(); openEdit(c); }}>Edit</Button>
          <Button size="sm" variant="ghost" icon={Power} loading={toggle.isPending} onClick={(e) => { e.stopPropagation(); toggle.mutate(c); }}>
            {c.active ? 'Disable' : 'Enable'}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader icon={Ticket} title="Coupons" subtitle="Promo codes riders apply to their booking fee." />
        <div className="flex items-center gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code…" className="w-40" />
          <Button icon={Plus} onClick={openNew}>New coupon</Button>
        </div>
      </div>

      <QueryBoundary
        query={query}
        loading={<LoadingScreen label="Loading coupons…" />}
        isEmpty={(d) => !d.length}
        empty={<EmptyState icon={Ticket} title="No coupons yet" message="Create one to start running an offer." />}
      >
        {(coupons) => <Table rowKey={(c) => c._id} data={coupons} columns={columns} />}
      </QueryBoundary>

      <CouponForm
        editing={editing}
        form={form}
        set={set}
        setForm={setForm}
        saving={save.isPending}
        onSave={() => save.mutate()}
        onClose={() => setEditing(null)}
      />
      <CouponDetail id={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}

function CouponForm({ editing, form, set, setForm, saving, onSave, onClose }) {
  const isNew = editing === 'new';
  return (
    <Modal
      open={!!editing}
      onClose={onClose}
      title={isNew ? 'New coupon' : `Edit ${editing?.code || ''}`}
      subtitle="Riders enter this code at payment."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={saving} onClick={onSave}>{isNew ? 'Create' : 'Save changes'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Code" hint={isNew ? 'letters & numbers' : 'cannot be changed'}>
            <Input
              value={form.code}
              disabled={!isNew}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
              placeholder="WELCOME50"
              className="tracking-widest"
            />
          </Field>
          <Field label="Number of coupons" hint="total redemptions">
            <Input type="number" min={1} value={form.totalCoupons} onChange={set('totalCoupons')} />
          </Field>
        </div>

        <Field label="Description" hint="shown to riders">
          <Input value={form.description} onChange={set('description')} placeholder="Launch offer" />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Discount type">
            <Select value={form.type} onChange={set('type')}>
              <option value="flat">Flat ₹ off</option>
              <option value="percent">Percent off</option>
            </Select>
          </Field>
          <Field label={form.type === 'percent' ? 'Percent off' : 'Amount off (₹)'}>
            <Input type="number" min={1} value={form.value} onChange={set('value')} />
          </Field>
        </div>

        {/* Max discount only exists for percent coupons, so it gets its own row
            rather than leaving a hole in a two-column grid. */}
        {form.type === 'percent' && (
          <Field label="Maximum discount (₹)" hint="0 = uncapped">
            <Input type="number" min={0} value={form.maxDiscount} onChange={set('maxDiscount')} />
          </Field>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Minimum fare (₹)" hint="0 = any">
            <Input type="number" min={0} value={form.minFare} onChange={set('minFare')} />
          </Field>
          <Field label="Per rider limit">
            <Input type="number" min={1} value={form.perUserLimit} onChange={set('perUserLimit')} />
          </Field>
          <Field label="Valid until" hint="optional">
            <Input type="date" value={form.validUntil} onChange={set('validUntil')} />
          </Field>
        </div>

        <p className="rounded-xl bg-ink-50 p-3 text-xs text-ink-500">
          The discount comes off the online booking fee. Stock can be raised later, but never cut below what has already been redeemed.
        </p>
      </div>
    </Modal>
  );
}

function CouponDetail({ id, onClose }) {
  const query = useQuery({
    queryKey: ['admin-coupon', id],
    queryFn: () => api.get(`/admin/coupons/${id}`),
    enabled: !!id,
  });
  const d = query.data;

  return (
    <Modal open={!!id} onClose={onClose} title={d?.coupon?.code || 'Coupon'} subtitle="Who has redeemed this code.">
      {query.isLoading ? (
        <p className="py-6 text-center text-sm text-ink-400">Loading…</p>
      ) : !d ? null : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Redeemed" value={d.coupon.usedCount} />
            <Stat label="Remaining" value={Math.max(0, d.coupon.totalCoupons - d.coupon.usedCount)} />
            <Stat label="Total" value={d.coupon.totalCoupons} />
          </div>
          {!d.redemptions.length ? (
            <p className="rounded-xl bg-ink-50 p-4 text-center text-sm text-ink-500">Not used yet.</p>
          ) : (
            <div className="divide-y divide-ink-100">
              {d.redemptions.map((r) => (
                <div key={r._id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-900">{r.user?.name || 'Rider'}</p>
                    <p className="text-xs text-ink-500">{r.user?.phone} · {formatDateTime(r.createdAt)}</p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-ink-900">−{inr(r.discount)}</span>
                  <Badge tone={r.status === 'used' ? 'success' : 'warning'}>{r.status === 'used' ? 'Used' : 'Held'}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl border border-ink-200 p-3 text-center">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</p>
      <p className="font-display text-xl font-bold text-ink-900">{value}</p>
    </div>
  );
}
