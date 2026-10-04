import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader, CardBody, Button, Input, Badge, Avatar, EmptyState, toast, useTranslations } from '@yatracab/ui';
import { UserPlus, Contact as ContactIcon, Trash2, Send, Info } from 'lucide-react';
import { api } from '../api.js';

// The Contact Picker is Chrome-on-Android only, and returns just the entries
// the user taps in the browser's own sheet — there is no bulk read. Every
// other browser falls back to typing a number.
const pickerSupported = () => typeof navigator !== 'undefined' && 'contacts' in navigator && 'ContactsManager' in window;

export function InviteContacts() {
  const t = useTranslations('Invite');
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const supported = pickerSupported();

  const listQ = useQuery({ queryKey: ['contacts'], queryFn: () => api.get('/customer/contacts').then((r) => r.contacts) });

  const save = useMutation({
    mutationFn: (contacts) => api.post('/customer/contacts', { contacts }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      const already = res.alreadyOnYatraCab;
      toast.success(`Added ${res.saved} contact${res.saved === 1 ? '' : 's'}${already ? ` — ${already} already ride with us` : ''}`);
      setName('');
      setPhone('');
    },
    onError: (err) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (id) => api.del(`/customer/contacts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts'] }),
    onError: (err) => toast.error(err.message),
  });

  const pickFromPhone = async () => {
    try {
      const picked = await navigator.contacts.select(['name', 'tel'], { multiple: true });
      const contacts = picked
        .filter((c) => c.tel?.length)
        .map((c) => ({ name: c.name?.[0] || '', phone: c.tel[0], source: 'picker' }));
      if (!contacts.length) return toast.error(t('noPhoneInEntry'));
      save.mutate(contacts);
    } catch {
      // The user dismissed the sheet — not an error worth surfacing.
    }
  };

  const addManual = () => {
    if (!phone.trim()) return toast.error(t('needPhone'));
    save.mutate([{ name: name.trim(), phone: phone.trim(), source: 'manual' }]);
  };

  return (
    <Card>
      <CardHeader title={t('title')} subtitle={t('subtitle')} icon={UserPlus} />
      <CardBody className="space-y-4">
        {supported ? (
          <Button variant="soft" icon={ContactIcon} onClick={pickFromPhone} disabled={save.isPending} className="w-full">
            Choose from contacts
          </Button>
        ) : (
          <div className="flex items-start gap-2 rounded-xl bg-ink-50 p-3 text-xs text-ink-500">
            <Info size={14} className="mt-0.5 shrink-0" />
            <p>{t('noPicker')}</p>
          </div>
        )}

        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('namePlaceholder')} className="flex-1" />
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t('phonePlaceholder')} className="flex-1" />
          <Button icon={Send} onClick={addManual} disabled={save.isPending}>{t('add')}</Button>
        </div>

        {!listQ.data?.length ? (
          <EmptyState icon={UserPlus} title={t('noneYet')} message={t('noneYetText')} />
        ) : (
          <div className="space-y-2">
            {listQ.data.map((c) => (
              <div key={c._id} className="flex items-center gap-3 rounded-xl border border-ink-100 p-3">
                <Avatar name={c.name || c.phone} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink-800">{c.name || c.phone}</p>
                  {c.name && <p className="truncate text-xs text-ink-400">{c.phone}</p>}
                </div>
                {c.joinedUser && <Badge tone="success">Already riding</Badge>}
                <button
                  type="button"
                  onClick={() => remove.mutate(c._id)}
                  title={t('remove')}
                  className="text-ink-300 transition-colors hover:text-danger"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
