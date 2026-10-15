import {z} from 'zod';
import {listSubjects,recordAudit} from '@/lib/db';
import {requireViewer,assertSameOrigin} from '@/lib/auth';
import {apiError,json,readJSON} from '@/lib/api';
import {platformDB,FEATURES,FEATURE_STATUS,featureCatalog,profileFor,audiencesFor,createAudience,setMembership,archiveAudience,chooseFeature,setFeatureRule,grantFeature,setConfirmedProfile,ownerOnly,setModeration,moderationEnabled,pendingPublications,reviewPublication} from '@/lib/platform';
export const runtime='nodejs';
const profile=z.object({faculty:z.string().min(1).max(100),direction:z.enum(['management','economics','other','common']),course:z.number().int().min(1).max(6),academicYear:z.string().regex(/^\d{4}\/\d{2}$/),semester:z.number().int().min(1).max(12),group:z.string().min(1).max(100)});
const action=z.discriminatedUnion('action',[
 z.object({action:z.literal('remove-rule'),id:z.string()}),
 z.object({action:z.literal('choice'),feature:z.enum(FEATURES),enabled:z.boolean()}),
 z.object({action:z.literal('audience'),profile,scope:z.enum(['group','stream']),label:z.string().min(1).max(160),groups:z.array(z.string().min(1).max(100)).min(1).max(100),subjectIds:z.array(z.string()).min(1).max(100)}),
 z.object({action:z.literal('membership'),userId:z.string().max(100),audienceId:z.string(),active:z.boolean()}),
 z.object({action:z.literal('archive'),audienceId:z.string(),archived:z.boolean()}),
 z.object({action:z.literal('rule'),feature:z.enum(FEATURES),selector:profile.partial(),status:z.enum(FEATURE_STATUS)}),
 z.object({action:z.literal('grant'),feature:z.enum(FEATURES),userId:z.string().max(100),grant:z.boolean()}),
 z.object({action:z.literal('profile'),telegramId:z.string().regex(/^[1-9]\d{0,19}$/),displayName:z.string().min(1).max(100),profile,identityConfirmed:z.literal(true)}),
 z.object({action:z.literal('moderation'),enabled:z.boolean()}),
 z.object({action:z.literal('review-publication'),materialId:z.string(),approve:z.boolean()})
]);
export async function GET(request:Request){try{const v=requireViewer(request);return json({profile:profileFor(v),features:featureCatalog(v),audiences:audiencesFor(v),moderation:moderationEnabled(),...(v.role==='owner'?{allSubjects:listSubjects(),memberships:platformDB().prepare('SELECT * FROM audience_memberships').all(),grants:platformDB().prepare('SELECT * FROM feature_grants').all(),rules:platformDB().prepare('SELECT * FROM feature_rules').all().map((r:any)=>({id:r.id,feature:r.feature,selector:JSON.parse(r.selector_json),status:r.status})),profiles:platformDB().prepare('SELECT user_id AS id,display_name AS displayName,profile_json AS profile FROM platform_profiles WHERE active=1').all().map((r:any)=>({...r,profile:JSON.parse(r.profile)})),pendingPublications:pendingPublications(v)}:{})});}catch(e){return apiError(e);}}
export async function POST(request:Request){try{const v=requireViewer(request);assertSameOrigin(request);const a=action.parse(await readJSON(request));if(a.action==='choice')return json(chooseFeature(v,a.feature,a.enabled));ownerOnly(v);
 switch(a.action){
 case 'remove-rule':platformDB().prepare('DELETE FROM feature_rules WHERE id=?').run(a.id);recordAudit(v.id,'feature.rule-removed','rule',a.id);break;
 case 'audience':return json(createAudience(v,{...a.profile,scope:a.scope,label:a.label,groups:a.groups,subjectIds:a.subjectIds}),201);
 case 'membership':setMembership(v,a.userId,a.audienceId,a.active);break;
 case 'archive':archiveAudience(v,a.audienceId,a.archived);break;
 case 'rule':setFeatureRule(v,a.feature,a.selector,a.status);break;
 case 'grant':grantFeature(v,a.userId,a.feature,a.grant);break;
 case 'profile':setConfirmedProfile(v,'student:'+a.telegramId,a.telegramId,a.displayName,a.profile);break;
 case 'moderation':setModeration(v,a.enabled);break;
 case 'review-publication':reviewPublication(v,a.materialId,a.approve);break;
 }return json({ok:true});}catch(e){return apiError(e);}}
