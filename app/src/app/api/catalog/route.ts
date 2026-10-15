import { requireViewer } from '@/lib/auth';
import { listSubjects } from '@/lib/db';
import { apiError, json } from '@/lib/api';
import { subjectsForProfile } from '@/lib/catalog';
import {subjectsForViewer,profileFor,featureCatalog,audiencesFor} from '@/lib/platform';
export const runtime = 'nodejs';
export async function GET(request: Request) { try { const viewer=requireViewer(request); return json({ subjects:subjectsForViewer(viewer),profile:profileFor(viewer),features:featureCatalog(viewer),audiences:audiencesFor(viewer) }); } catch (error) { return apiError(error); } }
