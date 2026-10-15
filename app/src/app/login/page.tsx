import {redirect} from 'next/navigation';
import LoginScreen from '@/components/LoginScreen';
import {getPageViewer} from '@/lib/auth';
export const dynamic = 'force-dynamic';
export default async function LoginPage() {
  if (await getPageViewer()) redirect('/');
  return <LoginScreen />;
}
