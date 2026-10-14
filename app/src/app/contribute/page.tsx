import ContributionPage from '@/components/ContributionPage';
import { publicRepositoryUrl } from '@/components/public-source';

export const dynamic = 'force-dynamic';

export default function Page() {
  return <ContributionPage repositoryUrl={publicRepositoryUrl(process.env.PUBLIC_SOURCE_REPOSITORY_URL, process.env.PUBLIC_SOURCE_REPOSITORY_VERIFIED)}/>;
}
