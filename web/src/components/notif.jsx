import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { post } from '../api.js';
import { useApi } from '../hooks.js';
import { useI18n } from '../i18n/index.jsx';
import { Async, fmtDate } from './ui.jsx';

// Notifications are stored as type + data and rendered here in the viewer's language.
export function notifText(t, n) {
  const d = n.data || {};
  if (d.title && d.message) return `${d.title} — ${d.message}`;
  return t(`notif.${n.type}`, { orderNo: d.orderNo || '', ticketNo: d.ticketNo || '', days: d.days ?? '', shop: d.shop || '', category: d.category ? t(`support.cat.${d.category}`) : '', stock: d.stock ?? '', reason: d.reason || '', note: d.note || '', event: d.event || '' });
}

export function NotificationList({ linkFor }) {
  const { t } = useI18n();
  const res = useApi('/notifications');
  useEffect(() => { if (res.data?.unread) post('/notifications/read').catch(() => {}); }, [res.data]);
  return (
    <Async res={res} empty={t('no_notifications')} isEmpty={(d) => !d.notifications.length}>
      {(d) => d.notifications.map((n) => {
        const to = linkFor?.(n);
        const body = <><div>{notifText(t, n)}</div><div className="muted small">{fmtDate(n.created_at)}</div></>;
        return to ? <Link key={n.id} to={to} className="card" style={{ display: 'block', marginBottom: 8, opacity: n.read_at ? 0.7 : 1 }}>{body}</Link>
          : <div key={n.id} className="card" style={{ marginBottom: 8, opacity: n.read_at ? 0.7 : 1 }}>{body}</div>;
      })}
    </Async>
  );
}
