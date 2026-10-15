import {redirect} from 'next/navigation';
import Workspace from '@/components/Workspace';
import {getPageViewer} from '@/lib/auth';
import {publicRepositoryUrl} from '@/components/public-source';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const viewer = await getPageViewer();
  if (!viewer) redirect('/login');
  return <Workspace initialViewer={viewer} repositoryUrl={publicRepositoryUrl(process.env.PUBLIC_SOURCE_REPOSITORY_URL,process.env.PUBLIC_SOURCE_REPOSITORY_VERIFIED)} />;
}
