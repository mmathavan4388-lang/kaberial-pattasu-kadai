import { useI18n } from '../i18n/index.jsx';
import { NotificationList } from '../components/notif.jsx';

export default function Notifications() {
  const { t } = useI18n();
  const link = (n) => n.data?.orderId ? `/orders/${n.data.orderId}` : n.data?.ticketId ? `/support/${n.data.ticketId}` : null;
  return <div className="stack"><h1>{t('notifications')}</h1><NotificationList linkFor={link} /></div>;
}
