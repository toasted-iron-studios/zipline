import type { File } from '@/lib/db/models/file';
import { Badge, Card } from '@mantine/core';
import { useState } from 'react';
import DashboardFileType from '../DashboardFileType';
import DashboardFileModal from './DashboardFileModal';

import styles from './index.module.css';

export default function DashboardFile({
  file,
  reduce,
  id,
  showOwner,
  onOpen,
}: {
  file: File;
  reduce?: boolean;
  id?: string;
  showOwner?: boolean;
  onOpen?: (fileId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {!onOpen && <DashboardFileModal open={open} setOpen={setOpen} file={file} reduce={reduce} user={id} />}

      <Card
        shadow='md'
        radius='md'
        p={0}
        onClick={() => (onOpen ? onOpen(file.id) : setOpen(true))}
        className={styles.file}
      >
        {showOwner && file.User && (
          <Badge pos='absolute' top={8} right={8} style={{ zIndex: 1 }}>
            {file.User.username}
          </Badge>
        )}
        <DashboardFileType key={file.id} file={file} />
      </Card>
    </>
  );
}
