import { Cloud } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cloudSyncStatusLabels, type CloudSyncEntryStatus } from '@/lib/cloud-sync-status';

type Props = {
  status: CloudSyncEntryStatus;
  onClick: () => void;
};

export function CloudSyncEntry({ status, onClick }: Props) {
  const statusLabel = cloudSyncStatusLabels[status];

  return <Button
    aria-label={`クラウド同期（${statusLabel}）`}
    className={`cloud-sync-button cloud-sync-status-${status}`}
    onClick={onClick}
    size="sm"
    title={`クラウド同期：${statusLabel}`}
    type="button"
    variant="outline"
  >
    <Cloud aria-hidden="true" />
    <span className="cloud-sync-button-label">クラウド同期</span>
    <span className="cloud-sync-status-label">{statusLabel}</span>
  </Button>;
}
