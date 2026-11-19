// Dev entry for /lipsync-lab.html (the app mounts LipSyncLab at /lab/lipsync itself).
import { createRoot } from 'react-dom/client';
import LipSyncLab from './LipSyncLab';

createRoot(document.getElementById('root')!).render(<LipSyncLab />);
