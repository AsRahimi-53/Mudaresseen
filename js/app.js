import { db, STORES } from './database.js';
import { t, hasKey, setLanguage, getLanguage, applyTranslations } from './translations.js';
import { todayISO, formatDate, formatNumber, downloadText, officialDocument, printTable, slug } from './utils.js';
import { setActiveNav, breadcrumbs, routeLabel } from './navigation.js';
import { createBackup, restoreBackup } from './backup.js';
import { exportRecords, exportWorkbook } from './export.js';
import * as dashboard from './dashboard.js';
import * as teamDashboard from './teamDashboard.js';
import * as members from './members.js';
import * as madrasas from './madrasas.js';
import * as teachers from './teachers.js';
import * as staff from './staff.js';
import * as statistics from './statistics.js';
import * as classes from './classes.js';
import * as regulations from './regulations.js';
import * as examResults from './examResults.js';
import * as tashkil from './tashkil.js';
import * as observations from './observations.js';
import * as annualPlans from './annualPlan.js';
import * as monthlyPlans from './monthlyPlan.js';
import * as duties from './duties.js';
import * as activities from './activities.js';
import * as professionalDevelopment from './professionalDevelopment.js';
import * as monitoring from './monitoring.js';
import * as reports from './reports.js';
import * as backupView from './backupView.js';
import * as settings from './settings.js';
import * as superAdmin from './superAdmin.js';
import { printRecord } from './moduleHelpers.js';
import { configure as configureOnline, getOnlineConfig, onlineApi, onlineSnapshot, subscribeOnline } from './onlineSync.js';

const routes = { dashboard, 'team-dashboard': teamDashboard, members, madrasas, teachers, staff, statistics, classes, regulations, 'exam-results': examResults, tashkil, observations, 'annual-plans': annualPlans, 'monthly-plans': monthlyPlans, duties, activities, 'professional-development': professionalDevelopment, monitoring, reports, backup: backupView, settings, 'super-admin': superAdmin };
const exportConfigs = {
  members: { name:'Scientific Members', file:'scientific-members', columns:[['fullName','Full name'],['fatherName','Father name'],['employeeId','Employee ID'],['position','Position'],['gender','Gender'],['phone','Phone'],['email','Email'],['education','Education'],['specialization','Specialization'],['appointmentDate','Appointment date'],['status','Status'],['notes','Notes']] },
  madrasas: { name:'Madrasas', file:'madrasas', columns:[['name','Madrasa name'],['code','Madrasa code'],['village','Village / Area'],['madrasaType','Madrasa type'],['genderType','Gender type'],['establishmentYear','Establishment year'],['headmasterName','Headmaster'],['headmasterPhone','Headmaster phone'],['amerName','Amer (head)'],['amerPhone','Amer phone'],['contact','Contact'],['address','Address'],['status','Status'],['notes','Notes']] },
  teachers: { name:'Teachers', file:'teachers', columns:[['fullName','Full name'],['fatherName','Father name'],['grandfatherName','Grandfather name'],['teacherId','Teacher ID'],['gender','Gender'],['dateOfBirth','Date of birth'],['madrasaId','Madrasa ID'],['position','Position'],['subject','Subject'],['specialization','Specialization'],['qualification','Qualification'],['professionalQualification','Professional qualification'],['experience','Experience'],['appointmentDate','Appointment date'],['employmentStatus','Employment status'],['tashkilPosition','Tashkil position'],['phone','Phone'],['address','Address'],['notes','Notes']] },
  staff: { name:'Administrative Staff', file:'administrative-staff', columns:[['fullName','Full name'],['fatherName','Father name'],['grandfatherName','Grandfather name'],['employeeId','Employee ID'],['gender','Gender'],['dateOfBirth','Date of birth'],['madrasaId','Madrasa ID'],['position','Position'],['department','Department'],['specialization','Specialization'],['qualification','Qualification'],['professionalQualification','Professional qualification'],['experience','Experience'],['appointmentDate','Appointment date'],['employmentStatus','Employment status'],['phone','Phone'],['email','Email'],['address','Address'],['notes','Notes']] },
  students: { name:'Student Statistics', file:'student-statistics', columns:[['madrasaId','Madrasa ID'],['academicYear','Academic year'],['date','Date'],['className','Class'],['section','Section'],['gender','Gender'],['count','Student count'],['notes','Notes']] },
  classes: { name:'Classes', file:'classes', columns:[['madrasaId','Madrasa ID'],['className','Class'],['section','Section'],['genderType','Class gender type'],['notes','Notes']] },
  regulations: { name:'Regulations', file:'regulations-and-guidelines', columns:[['title','Title'],['docType','Document type'],['documentNumber','Document number'],['issuingAuthority','Issuing authority'],['issueDate','Issue date'],['effectiveDate','Effective date'],['regCategory','Category'],['status','Status'],['summary','Summary'],['documentLink','Link'],['notes','Notes']] },
  examResults: { name:'Exam Results', file:'exam-results', columns:[['madrasaId','Madrasa ID'],['academicYear','Academic year'],['examType','Exam type'],['className','Class'],['resultStatus','Result status'],['tablesCount','Tables count'],['receivedDate','Received date'],['reviewedDate','Reviewed date'],['reviewerId','Reviewer'],['rejectionReason','Rejection / correction reason'],['notes','Notes']] },
  statistics: { name:'Statistics', file:'statistics', columns:[['category','Category'],['indicator','Indicator'],['value','Value'],['madrasaId','Madrasa ID'],['academicYear','Academic year'],['date','Date'],['notes','Notes']] },
  observations: { name:'Observations', file:'teacher-observations', columns:[['teacherName','Teacher'],['fatherName','Father name'],['madrasaName','Madrasa'],['observationNumber','Observation number'],['academicYear','Academic year'],['observationDate','Observation date'],['observerName','Observer'],['teachingSubject','Teaching subject'],['lessonClass','Class'],['lessonSection','Section'],['lessonTopic','Lesson topic'],['lessonDuration','Duration'],['totalScore','Total score'],['rawTotalScore','Raw total score'],['rawObtainedScore','Raw obtained score'],['obtainedScore','Obtained score'],['percentage','Percentage'],['criteriaScores','Criteria scores'],['scoringConfig','Scoring configuration'],['qualityLevel','Quality level'],['strengths','Strengths'],['weaknesses','Weaknesses'],['recommendationsGiven','Recommendations'],['followUpDate','Follow-up date']] },
  annualPlans: { name:'Annual Plans', file:'annual-plans', columns:[['title','Plan title'],['objective','Objective'],['activity','Activity'],['expectedResult','Expected result'],['targetGroup','Target group'],['madrasaId','Madrasa ID'],['startDate','Start date'],['endDate','End date'],['responsibleMember','Responsible member'],['status','Status'],['priority','Priority'],['resources','Resources'],['notes','Notes']] },
  monthlyPlans: { name:'Monthly Plans', file:'monthly-plans', columns:[['year','Year'],['month','Month'],['activity','Activity'],['objective','Objective'],['expectedResult','Expected result'],['responsibleMember','Responsible member'],['madrasaId','Madrasa ID'],['date','Date'],['deadline','Deadline'],['status','Status'],['result','Result'],['notes','Notes']] },
  duties: { name:'Duties', file:'duties', columns:[['title','Duty title'],['description','Description'],['assignedMember','Assigned member'],['date','Date'],['deadline','Deadline'],['madrasaId','Madrasa ID'],['priority','Priority'],['status','Status'],['completionDate','Completion date'],['result','Result'],['notes','Notes']] },
  activities: { name:'Activities', file:'activities', columns:[['title','Activity title'],['activityType','Activity type'],['date','Date'],['location','Location'],['madrasaId','Madrasa ID'],['responsibleMember','Responsible member'],['participants','Participants'],['description','Description'],['results','Results'],['problems','Problems'],['recommendations','Recommendations'],['status','Status'],['notes','Notes']] },
  professionalDevelopment: { name:'Professional Development', file:'professional-development', columns:[['title','Program title'],['trainingType','Training type'],['date','Date'],['location','Location'],['trainer','Trainer'],['madrasaId','Madrasa ID'],['targetTeachers','Target teachers'],['participantsNumber','Participants'],['maleParticipants','Male participants'],['femaleParticipants','Female participants'],['topics','Topics'],['objectives','Objectives'],['results','Results'],['problems','Problems'],['recommendations','Recommendations'],['followUpStatus','Follow-up status'],['responsibleMember','Responsible member']] },
  monitoring: { name:'Monitoring', file:'monitoring', columns:[['madrasaId','Madrasa ID'],['date','Date'],['memberId','Scientific member'],['purpose','Purpose'],['teacherSituation','Teacher situation'],['studentSituation','Student situation'],['administration','Administration'],['attendance','Attendance'],['teachingQuality','Teaching quality'],['tashkil','Tashkil'],['facilities','Facilities'],['booksMaterials','Books / materials'],['problems','Problems'],['findings','Findings'],['recommendations','Recommendations'],['requiredActions','Required actions'],['followUpDate','Follow-up date'],['status','Status']] },
  reports: { name:'Reports', file:'reports', columns:[['reportNumber','Report number'],['title','Report title'],['type','Report type'],['date','Date'],['preparedById','Prepared by'],['relatedMember','Related member'],['relatedMadrasa','Related madrasa'],['subject','Subject'],['introduction','Introduction'],['objectives','Objectives'],['activities','Activities'],['statistics','Statistics'],['findings','Findings'],['problems','Problems'],['analysis','Analysis'],['recommendations','Recommendations'],['conclusion','Conclusion'],['followUp','Follow-up'],['status','Status'],['notes','Notes']] }
};
const state = { settings:null, route:'dashboard', params:{}, history:[], rendering:false, accountLabel:null, printing:false };

function context(){ return { get settings(){ return state.settings; }, get params(){ return state.params; }, get online(){ return onlineApi(); }, navigate, refresh:()=>renderCurrent(), notify, confirm, openModal, openOnlineAuth:openOnlineLogin, closeModal, saveSettings, printOfficial, export:exportStore, actions:{ backup:doBackup, restore:doRestore, restoreFile, clear:clearData } }; }
function updateShell(){ const s=state.settings||{}; document.body.classList.toggle('theme-dark',s.theme==='dark'); document.getElementById('district-label').textContent = [s.province,s.district].filter(Boolean).join(' · ') || '—'; const operator = document.getElementById('operator-label'); if (operator) operator.textContent = state.accountLabel || onlineSnapshot().profile?.display_name || (onlineSnapshot().isSuperAdmin ? t('superAdmin') : t('administrator')); const avatar=document.querySelector('#account-toggle .avatar'); if(avatar) avatar.textContent=String(operator?.textContent||'').trim().slice(0,1)||'A'; document.getElementById('brand-logo').innerHTML = s.logo ? `<img src="${escapeAttr(s.logo)}" alt="" style="width:100%;height:100%;object-fit:contain;border-radius:12px">` : '✦'; const topLogo=document.getElementById('topbar-logo'); if(topLogo) topLogo.innerHTML=document.getElementById('brand-logo').innerHTML; document.documentElement.lang = getLanguage()==='ps'?'ps':'fa'; document.documentElement.dir='rtl'; const toggle=document.getElementById('language-toggle'); if(toggle) toggle.textContent=getLanguage()==='ps'?'دری':'پښتو'; const onlineStatus=document.getElementById('online-status'); if(onlineStatus){const online=onlineSnapshot();onlineStatus.textContent=online.configured?(online.status==='online'?t('online'):online.status==='syncing'?t('syncing'):online.status==='login-required'?t('loginRequired'):t('onlineConfigured')):t('offline');onlineStatus.className=`sidebar-online-status ${online.status}`;}}
function escapeAttr(v){return String(v||'').replace(/&/g,'&amp;').replace(/\"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
async function toggleAccountMenu(){
  const menu=document.getElementById('account-menu'), toggle=document.getElementById('account-toggle');
  if(!menu||!toggle)return;
  if(!menu.classList.contains('hidden')){closeAccountMenu();return;}
  const members=await db.getAll('members');
  const selectedId=state.route==='team-dashboard'?state.params?.member||'':'';
  menu.innerHTML=`<div class="account-menu-head"><strong>${escapeHtml(t('accountMenu'))}</strong><small>${escapeHtml(t('selectAcademicMember'))}</small></div><button type="button" data-account-action="general">⌂ <span>${escapeHtml(t('generalDashboard'))}</span></button><div class="account-menu-label">${escapeHtml(t('selectAcademicMember'))}</div>${members.length?members.map(member=>`<button type="button" data-account-member="${escapeAttr(member.id)}" class="${member.id===selectedId?'active':''}"><span class="menu-avatar">${escapeHtml(String(member.fullName||'•').trim().slice(0,2))}</span><span>${escapeHtml(member.fullName||'—')}<small style="display:block;color:var(--muted);font-size:9px">${escapeHtml(member.position||'')}</small></span>${member.id===selectedId?'<span class="menu-status">✓</span>':''}</button>`).join(''):`<div class="no-data" style="padding:15px 8px">${escapeHtml(t('noMembers'))}</div>`}<div class="menu-divider"></div><button type="button" data-account-action="settings">⚙ <span>${escapeHtml(t('settings'))}</span></button>`;
  menu.classList.remove('hidden'); toggle.setAttribute('aria-expanded','true');
}
function closeAccountMenu(){const menu=document.getElementById('account-menu'),toggle=document.getElementById('account-toggle');if(menu)menu.classList.add('hidden');if(toggle)toggle.setAttribute('aria-expanded','false');}
async function saveSettings(next){ state.settings=await db.saveSettings({...next,id:'app'}); await configureOnline(state.settings); const remoteSettings=await db.getSettings(); if(remoteSettings) state.settings=remoteSettings; if(next.language && next.language!==getLanguage()){ setLanguage(next.language); applyTranslations(document); } updateShell(); await renderCurrent(); }
function navigate(route, params={}, options={}){ if(!routes[route]||(route==='super-admin'&&!onlineSnapshot().isSuperAdmin)) route='dashboard'; if(route!=='team-dashboard') state.accountLabel=null; closeAccountMenu(); if(!options.replace && (state.route!==route || JSON.stringify(state.params)!==JSON.stringify(params))) state.history.push({route:state.route,params:{...state.params,autoAdd:false}}); state.route=route; state.params={...params}; closeModal(); renderCurrent(); }
function goBack(){ const previous=state.history.pop(); if(!previous){ notify(t('noRecords'),'info'); return; } state.route=previous.route; state.params=previous.params; closeModal(); renderCurrent(); }
async function renderCurrent(){
  if(state.route==='super-admin'&&!onlineSnapshot().isSuperAdmin){state.route='dashboard';state.params={};state.history=state.history.filter(item=>item.route!=='super-admin');}
  const token = (state.renderToken = (state.renderToken || 0) + 1);
  const previousRoot = document.getElementById('view-root');
  const root = previousRoot.cloneNode(false);
  previousRoot.replaceWith(root);
  const module = routes[state.route] || dashboard;
  const routeAtStart = state.route;
  setActiveNav(state.route);
  document.getElementById('breadcrumbs').innerHTML = breadcrumbs(state.route, state.params?.label ? { label: state.params.label } : {});
  document.getElementById('back-btn').disabled = state.history.length === 0;
  root.innerHTML = '<div class="card"><div class="empty-state"><div class="spinner" style="margin:auto"></div><p>…</p></div></div>';
  try {
    const html = await module.render(context());
    if (token !== state.renderToken || routeAtStart !== state.route) return;
    root.innerHTML = html;
    applyTranslations(root);
    await module.bind?.(context(), root);
    if (token !== state.renderToken || routeAtStart !== state.route) return;
    const auto = Boolean(state.params?.autoAdd);
    const autoTeacher = state.params?.teacherId || '';
    if (auto) {
      state.params = { ...state.params, autoAdd: false };
      if (module.autoAdd) await module.autoAdd({ ...context(), params: { ...state.params, teacherId: autoTeacher } });
    }
  } catch(error) {
    if (token !== state.renderToken) return;
    console.error(error);
    root.innerHTML = `<section class="card"><div class="empty-state"><div class="empty-icon">!</div><h3>${escapeHtml(error.message||t('error'))}</h3><p>${escapeHtml(t('error'))}</p><button class="btn outline" data-view="dashboard">${escapeHtml(t('dashboard'))}</button></div></section>`;
  } finally {
    if (token === state.renderToken) updateShell();
  }
}
function escapeHtml(v){return String(v||'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function notify(message,type='info'){const stack=document.getElementById('toast-root');const el=document.createElement('div');el.className=`toast ${type}`;el.innerHTML=`<span>${type==='success'?'✓':type==='error'?'!':type==='warning'?'⚠':'i'}</span><span>${escapeHtml(message)}</span>`;stack.appendChild(el);setTimeout(()=>el.remove(),4200);}
function confirm(message){ return new Promise(resolve=>{const root=document.getElementById('confirm-root');root.classList.remove('hidden');root.innerHTML=`<div class="confirm-card"><div class="confirm-icon">?</div><h3>${escapeHtml(t('confirm'))}</h3><p>${escapeHtml(message)}</p><div class="confirm-actions"><button class="btn danger" data-confirm="yes">${escapeHtml(t('yes'))}</button><button class="btn outline" data-confirm="no">${escapeHtml(t('no'))}</button></div></div>`;const finish=value=>{root.classList.add('hidden');root.innerHTML='';resolve(value);};root.querySelector('[data-confirm="yes"]').onclick=()=>finish(true);root.querySelector('[data-confirm="no"]').onclick=()=>finish(false);}); }
function openModal(title,body,options={}){const root=document.getElementById('modal-root');root.classList.remove('hidden');root.innerHTML=`<div class="modal-card ${options.wide?'wide':''}"><div class="modal-head"><h2>${escapeHtml(title)}</h2><button class="modal-close" type="button" data-modal-close>×</button></div><div class="modal-body">${body}</div></div>`;document.body.classList.add('modal-open');}
function closeModal(){const root=document.getElementById('modal-root');root.classList.add('hidden');root.innerHTML='';document.body.classList.remove('modal-open');}
async function openOnlineLogin(initialMode='login') {
  const online=onlineApi();
  if(online.session)return;
  if(!online.configured){notify(t('onlineNotConfigured'),'error');return;}
  let districts=[]; try{districts=await online.listDistricts();}catch(error){console.warn('District list unavailable',error);}
  const registeredDistricts=districts.length>0;
  const districtFields=registeredDistricts
    ? `<label class="field span-2"><span>${escapeHtml(t('provinceAndDistrict'))}</span><select name="tenantKey" required><option value="">${escapeHtml(t('selectDistrict'))}</option>${districts.map(item=>`<option value="${escapeAttr(item.tenant_id||`${item.province_id}:${item.district_id}`)}">${escapeHtml(`${item.province_name} · ${item.district_name}`)}</option>`).join('')}</select><small class="form-hint">${escapeHtml(t('registeredDistrictHint'))}</small></label>`
    : `<label class="field"><span>${escapeHtml(t('provinceName'))}</span><input name="provinceName" required></label><label class="field"><span>${escapeHtml(t('districtName'))}</span><input name="districtName" required><small class="form-hint">${escapeHtml(t('firstDistrictHint'))}</small></label>`;
  openModal(t('onlineLogin'),`<div class="auth-switch"><button type="button" class="tab-btn active" data-auth-mode="login">${escapeHtml(t('login'))}</button><button type="button" class="tab-btn" data-auth-mode="signup">${escapeHtml(t('signUp'))}</button></div><form id="online-login-form" class="form-grid"><div class="form-section"><h3>${escapeHtml(t('centralDatabase'))}</h3><p class="form-hint">${escapeHtml(t('onlineLoginHint'))}</p></div><label class="field"><span>${escapeHtml(t('email'))}</span><input type="email" name="email" required autocomplete="username"></label><label class="field"><span>${escapeHtml(t('password'))}</span><input type="password" name="password" required autocomplete="current-password"></label><div id="online-login-error" class="form-hint" style="color:#b91c1c"></div><div class="form-actions"><button class="btn primary" type="submit">✓ ${escapeHtml(t('login'))}</button><button class="btn outline" type="button" data-online-offline>${escapeHtml(t('useOffline'))}</button></div></form><form id="online-signup-form" class="form-grid hidden"><div class="form-section"><h3>${escapeHtml(t('createAccount'))}</h3><p class="form-hint">${escapeHtml(registeredDistricts?t('signUpRegisteredHint'):t('signUpFirstDistrictHint'))}</p></div><label class="field"><span>${escapeHtml(t('fullName'))}</span><input name="fullName" required></label><label class="field"><span>${escapeHtml(t('phone'))}</span><input name="phone" type="tel"></label>${districtFields}<label class="field"><span>${escapeHtml(t('email'))}</span><input type="email" name="email" required autocomplete="email"></label><label class="field"><span>${escapeHtml(t('password'))}</span><input type="password" name="password" minlength="6" required autocomplete="new-password"></label><label class="field span-2"><span>${escapeHtml(t('confirmPassword'))}</span><input type="password" name="confirmPassword" minlength="6" required autocomplete="new-password"></label><div id="online-signup-error" class="form-hint" style="color:#b91c1c"></div><div class="form-actions"><button class="btn primary" type="submit">✓ ${escapeHtml(t('signUp'))}</button><button class="btn outline" type="button" data-online-offline>${escapeHtml(t('useOffline'))}</button></div></form>`,{wide:true});
  const loginForm=document.getElementById('online-login-form'); const signupForm=document.getElementById('online-signup-form'); const modes=[...document.querySelectorAll('[data-auth-mode]')];
  const showMode=mode=>{const signup=mode==='signup';loginForm?.classList.toggle('hidden',signup);signupForm?.classList.toggle('hidden',!signup);modes.forEach(button=>button.classList.toggle('active',button.dataset.authMode===mode));};
  modes.forEach(button=>button.addEventListener('click',()=>showMode(button.dataset.authMode))); showMode(initialMode);
  loginForm?.addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(loginForm);const error=document.getElementById('online-login-error');try{loginForm.querySelector('button[type="submit"]').disabled=true;await online.signIn(data.get('email'),data.get('password'));state.settings=await db.getSettings()||state.settings;closeModal();updateShell();notify(t('loginSuccess'),'success');await renderCurrent();}catch(err){if(error)error.textContent=err.message||t('error');}finally{loginForm.querySelector('button[type="submit"]').disabled=false;}});
  signupForm?.addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(signupForm);const error=document.getElementById('online-signup-error');if(data.get('password')!==data.get('confirmPassword')){if(error)error.textContent=t('passwordMismatch');return;}try{signupForm.querySelector('button[type="submit"]').disabled=true;const selected=registeredDistricts?districts.find(item=>(item.tenant_id||`${item.province_id}:${item.district_id}`)===data.get('tenantKey')):null;const result=await online.signUp(selected?{email:data.get('email'),password:data.get('password'),provinceId:selected.province_id,provinceName:selected.province_name,districtId:selected.district_id,districtName:selected.district_name,fullName:data.get('fullName'),phone:data.get('phone')}:{email:data.get('email'),password:data.get('password'),provinceName:data.get('provinceName'),districtName:data.get('districtName'),fullName:data.get('fullName'),phone:data.get('phone')});if(result.needsEmailConfirmation){if(error)error.textContent=t('signupConfirmation');showMode('login');}else{state.settings=await db.getSettings()||state.settings;closeModal();updateShell();notify(t('signupSuccess'),'success');await renderCurrent();}}catch(err){if(error)error.textContent=err.message||t('error');}finally{signupForm.querySelector('button[type="submit"]').disabled=false;}});
  document.querySelectorAll('[data-online-offline]').forEach(button=>button.addEventListener('click',closeModal));
}
async function initializeOnline(){const runtime=getOnlineConfig(state.settings||{});if(runtime.enabled&&(!state.settings?.onlineConfig||!state.settings.onlineConfig.supabaseUrl)){state.settings=await db.saveSettings({...state.settings,onlineConfig:runtime},{skipRemote:true});}await configureOnline(state.settings||{});const pulled=await db.getSettings();if(pulled)state.settings=pulled;updateShell();}
async function printOfficial(title,body){if(state.printing)return;const root=document.getElementById('print-root');if(!root)return;state.printing=true;root.innerHTML=officialDocument(state.settings||{},title,body);let mediaQuery=null;let mediaListener=null;let fallbackTimer=null;const cleanup=()=>{if(!state.printing)return;state.printing=false;root.innerHTML='';window.removeEventListener('afterprint',cleanup);if(mediaQuery&&mediaListener){mediaQuery.removeEventListener?.('change',mediaListener);mediaQuery.removeListener?.(mediaListener);}if(fallbackTimer)clearTimeout(fallbackTimer);};window.addEventListener('afterprint',cleanup,{once:true});if(window.matchMedia){mediaQuery=window.matchMedia('print');mediaListener=event=>{if(!event.matches)cleanup();};mediaQuery.addEventListener?.('change',mediaListener);mediaQuery.addListener?.(mediaListener);}try{window.print();fallbackTimer=setTimeout(cleanup,120000);}catch(error){cleanup();throw error;}}
const exportLabelMap={category:'category',indicator:'indicator',value:'value',name:'madrasaName',code:'madrasaCode',academicYear:'academicYear',className:'class',section:'section',count:'studentCount',staffType:'staffType',staffName:'staffName',employeeId:'employeeId',appointmentDate:'appointmentDate',establishmentYear:'establishmentYear',tashkilPosition:'tashkilPosition',department:'department',fullName:'fullName',fatherName:'fatherName',grandfatherName:'grandfatherName',teacherId:'teacherId',studentId:'studentId',position:'position',gender:'gender',phone:'phone',email:'email',education:'education',specialization:'specialization',status:'status',madrasaId:'madrasa',madrasaIds:'relatedMadrasa',madrasaName:'madrasa',madrasaType:'madrasaType',genderType:'genderType',village:'villageArea',principal:'principal',contact:'phone',address:'address',subject:'subject',qualification:'qualification',professionalQualification:'professionalQualification',experience:'experience',date:'date',deadline:'deadline',observationDate:'observationDate',observationNumber:'observationNumber',observerName:'observer',observerId:'observer',teacherName:'teacher',teachingSubject:'teachingSubject',lessonClass:'lessonClass',lessonSection:'lessonSection',lessonTopic:'lessonTopic',lessonDuration:'lessonDuration',totalScore:'totalScore',obtainedScore:'obtainedScore',percentage:'percentage',qualityLevel:'qualityLevel',qualityKey:'qualityLevel',criteriaScores:'criteria',scoringConfig:'scoringConfig',rawTotalScore:'rawTotalScore',rawObtainedScore:'rawObtainedScore',title:'planTitle',activity:'activity',objective:'objective',expectedResult:'expectedResult',startDate:'startDate',endDate:'endDate',responsibleMember:'responsibleMember',responsibleMembers:'responsibleMember',priority:'priority',resources:'resources',year:'year',month:'month',dutyTitle:'dutyTitle',description:'description',assignedMember:'assignedMember',assignedMembers:'assignedMember',completionDate:'completionDate',result:'result',results:'results',activityType:'activityType',location:'location',participants:'participants',programTitle:'programTitle',trainingType:'trainingType',trainer:'trainer',participantsNumber:'participantsNumber',maleParticipants:'maleParticipants',femaleParticipants:'femaleParticipants',purpose:'purpose',findings:'findings',recommendations:'recommendations',recommendationsGiven:'recommendationsGiven',followUpDate:'followUpDate',reportNumber:'reportNumber',reportTitle:'reportTitle',reportType:'reportType',type:'reportType',preparedBy:'preparedBy',preparedById:'preparedBy',preparedByIds:'preparedBy',relatedMember:'relatedMember',relatedMembers:'relatedMember',relatedMadrasa:'relatedMadrasa',relatedMadrasas:'relatedMadrasa',memberId:'responsibleMember',memberIds:'responsibleMember',notes:'notes'};
const exportPluralFields={madrasaId:'madrasaIds',responsibleMember:'responsibleMembers',assignedMember:'assignedMembers',memberId:'memberIds',preparedById:'preparedByIds',relatedMember:'relatedMembers',relatedMadrasa:'relatedMadrasas'};
const exportDateFields=new Set(['date','deadline','observationDate','appointmentDate','dateOfBirth','startDate','endDate','completionDate','followUpDate']);
const exportMemberFields=new Set(['responsibleMember','responsibleMembers','assignedMember','assignedMembers','memberId','memberIds','preparedById','preparedByIds','relatedMember','relatedMembers','observerId','observerName']);
const exportMadrasaFields=new Set(['madrasaId','madrasaIds','relatedMadrasa','relatedMadrasas']);
const exportTeacherFields=new Set(['teacherId','teacherIds']);
const exportReportTypes={daily:'reportDaily',weekly:'reportWeekly',member:'reportMember',statistics:'reportStatistics',monthly:'reportMonthly',quarterly:'reportQuarterly',annual:'reportAnnual',team:'reportTeam',madrasa:'reportMadrasa',teacher:'reportTeacher',student:'reportStudent',tashkil:'reportTashkil',observation:'reportObservation',plan:'reportPlan',duty:'reportDuty',activity:'reportActivity',monitoring:'reportMonitoring',professionalDevelopment:'professionalDevelopment'};
const exportSheetLabels={members:'members',madrasas:'madrasas',teachers:'teachers',staff:'staff',students:'studentStatistics',observations:'observations',annualPlans:'annualPlan',monthlyPlans:'monthlyPlan',duties:'duties',activities:'activities',professionalDevelopment:'professionalDevelopment',monitoring:'monitoring',reports:'reports'};
function exportCellValue(row,key,members,madrasas,teachers){let value=row[exportPluralFields[key]] ?? row[key];if(value===undefined||value===null)value='';const values=Array.isArray(value)?value:[value];if(exportMemberFields.has(key))return values.map(id=>members.find(m=>m.id===id)?.fullName||id||'—').join('، ');if(exportMadrasaFields.has(key))return values.map(id=>madrasas.find(m=>m.id===id)?.name||madrasas.find(m=>m.id===id)?.madrasaName||id||'—').join('، ');if(exportTeacherFields.has(key))return values.map(id=>teachers.find(item=>item.id===id)?.fullName||id||'—').join('، ');if(exportDateFields.has(key))return formatDate(value);if(key==='createdAt')return formatDate(value);if(key==='month'&&Number(value)>=1&&Number(value)<=12)return t(`solarMonth${Number(value)}`,value);if(key==='madrasaType'&&value==='government')value='official';if(key==='type'||key==='reportType')return t(exportReportTypes[value]||value,value);if(Array.isArray(value)&&value.some(item=>item&&typeof item==='object'))return value.map(item=>Object.entries(item).map(([k,v])=>`${k}: ${v}`).join('، ')).join('؛ ');if(Array.isArray(value))return value.join('، ');if(value&&typeof value==='object')return Object.entries(value).map(([k,v])=>`${k}: ${v}`).join('، ');if(typeof value==='string'&&hasKey(value))return t(value,value);return value;}
async function exportStore(store){const config=exportConfigs[store];if(!config)return notify(t('error'),'error');const [records,members,madrasas,teachers]=await Promise.all([db.getAll(store),db.getAll('members'),db.getAll('madrasas'),db.getAll('teachers')]);const columns=config.columns.map(([key,label])=>({key,label:t(exportLabelMap[key]||key,label),value:row=>exportCellValue(row,key,members,madrasas,teachers)}));const sheetName=t(exportSheetLabels[store]||store,config.name);exportRecords(`${config.file}-${todayISO()}.xlsx`,sheetName,records,columns);notify(t('exportExcel'),'success');}
async function doBackup(){try{await createBackup();notify(t('backupCreated'),'success');}catch(error){console.error(error);notify(error.message||t('error'),'error');}}
async function restoreFile(file){try{const ok=await restoreBackup(file,confirm);if(ok){state.settings=await db.getSettings();setLanguage(state.settings?.language||'ps');applyTranslations(document);updateShell();notify(t('backupRestored'),'success');await renderCurrent();}}catch(error){console.error(error);notify(error.message||t('error'),'error');}}
async function doRestore(){const input=document.createElement('input');input.type='file';input.accept='application/json,.json';input.onchange=()=>input.files[0]&&restoreFile(input.files[0]);input.click();}
async function clearData(){const online=onlineSnapshot();if(online.configured&&online.session&&online.profile?.role!=='admin')return notify(t('deleteAdminOnly'),'warning');const ok=await confirm(t('restoreWarning'));if(!ok)return;try{for(const store of STORES){if(store!=='settings')await db.clear(store);}notify(t('saved'),'success');await renderCurrent();}catch(error){console.error(error);notify(t('error'),'error');}}
function closeGlobalSearch(){const results=document.getElementById('global-search-results');if(results){results.classList.add('hidden');results.innerHTML='';}}
async function searchEverywhere(query){
  const results=document.getElementById('global-search-results'); if(!results)return;
  const q=String(query||'').trim().toLocaleLowerCase(); if(q.length<2){closeGlobalSearch();return;}
  const configs=[
    {store:'members',view:'members',icon:'♟',name:r=>r.fullName,meta:r=>`${t('members')} · ${r.employeeId||r.position||''}`,fields:r=>[r.fullName,r.fatherName,r.employeeId,r.phone,r.position]},
    {store:'madrasas',view:'madrasas',icon:'▦',name:r=>r.name,meta:r=>`${t('madrasas')} · ${r.code||r.village||''}`,fields:r=>[r.name,r.code,r.village,r.principal,r.address]},
    {store:'teachers',view:'teachers',icon:'♙',name:r=>r.fullName,meta:r=>`${t('teachers')} · ${r.teacherId||r.subject||''}`,fields:r=>[r.fullName,r.fatherName,r.teacherId,r.subject,r.specialization]},
    {store:'students',view:'statistics',icon:'♧',name:r=>`${r.className||t('class')} · ${t(r.gender,r.gender)}`,meta:r=>`${t('studentStatistics')} · ${r.academicYear||''} · ${r.count||r.value||1}`,fields:r=>[r.className,r.section,r.gender,r.academicYear,r.madrasaId]},
    {store:'staff',view:'staff',icon:'♟',name:r=>r.fullName||r.employeeId,meta:r=>`${t('staff')} · ${r.position||''}`,fields:r=>[r.fullName,r.fatherName,r.employeeId,r.position,r.department,r.specialization,r.phone]},
    {store:'activities',view:'activities',icon:'✦',name:r=>r.title,meta:r=>`${t('activities')} · ${r.date||''}`,fields:r=>[r.title,r.activityType,r.location,r.description,r.results]},
    {store:'duties',view:'duties',icon:'✓',name:r=>r.title,meta:r=>`${t('duties')} · ${r.deadline||''}`,fields:r=>[r.title,r.description,r.status,r.result]},
    {store:'reports',view:'reports',icon:'▤',name:r=>r.title,meta:r=>`${t('reports')} · ${r.reportNumber||''}`,fields:r=>[r.title,r.reportNumber,r.subject,r.type,r.status]},
    {store:'observations',view:'observations',icon:'◉',name:r=>r.teacherName,meta:r=>`${t('observations')} · ${r.observationDate||''}`,fields:r=>[r.teacherName,r.observerName,r.teachingSubject,r.lessonClass,r.qualityLevel]}
  ];
  const matches=[];
  for(const config of configs){const rows=await db.getAll(config.store);for(const row of rows){if(config.fields(row).some(value=>String(value||'').toLocaleLowerCase().includes(q))){matches.push({...config,row});if(matches.length>=15)break;}}if(matches.length>=15)break;}
  results.innerHTML=matches.length?matches.map(item=>`<button type="button" class="global-search-result" data-global-result data-global-view="${escapeAttr(item.view)}" data-global-id="${escapeAttr(['members','madrasas','teachers'].includes(item.store)?item.row.id:'')}" data-global-query="${escapeAttr(query)}"><span class="result-icon">${item.icon}</span><span><strong>${escapeHtml(item.name(item.row)||'—')}</strong><small>${escapeHtml(item.meta(item.row)||'')}</small></span></button>`).join(''):`<div class="global-search-empty">${escapeHtml(t('noRecords'))}</div>`;
  results.classList.remove('hidden');
}
function installGlobalEvents(){document.addEventListener('click',e=>{const recordPrint=e.target.closest('[data-record-print]');if(recordPrint){e.preventDefault();printRecord(context(),recordPrint.dataset.store,recordPrint.dataset.id);return;}const globalResult=e.target.closest('[data-global-result]');if(globalResult){const view=globalResult.dataset.globalView;const id=globalResult.dataset.globalId;const query=globalResult.dataset.globalQuery;closeGlobalSearch();navigate(view,id?{id}:{q:query});return;}if(e.target.closest('#account-toggle')){e.preventDefault();toggleAccountMenu();return;}const memberButton=e.target.closest('[data-account-member]');if(memberButton){const memberId=memberButton.dataset.accountMember;const memberName=memberButton.querySelector('span:nth-child(2)')?.childNodes?.[0]?.textContent?.trim()||t('member');state.accountLabel=memberName;closeAccountMenu();navigate('team-dashboard',{member:memberId});return;}const accountAction=e.target.closest('[data-account-action]')?.dataset.accountAction;if(accountAction==='general'){state.accountLabel=null;closeAccountMenu();navigate('dashboard');return;}if(accountAction==='settings'){state.accountLabel=null;closeAccountMenu();navigate('settings');return;}if(!e.target.closest('.account-wrap'))closeAccountMenu();if(!e.target.closest('.global-search-wrap'))closeGlobalSearch();if(e.target.closest('[data-action="toggle-language"]')){const next=getLanguage()==='ps'?'dr':'ps';setLanguage(next);applyTranslations(document);updateShell();return;}const nav=e.target.closest('[data-view]');if(nav){const params={};if(nav.dataset.autoAdd)params.autoAdd=true;if(nav.dataset.teacherId)params.teacherId=nav.dataset.teacherId;navigate(nav.dataset.view,params);document.getElementById('sidebar')?.classList.remove('open');return;}if(e.target.closest('[data-modal-close]')){closeModal();return;}if(e.target.id==='back-btn'||e.target.closest('#back-btn')){goBack();return;}if(e.target.id==='language-toggle'||e.target.closest('#language-toggle')){const next=getLanguage()==='ps'?'dr':'ps';setLanguage(next);applyTranslations(document);if(state.settings){saveSettings({...state.settings,language:next});}else{updateShell();}return;}if(e.target.id==='quick-backup'||e.target.closest('#quick-backup')){doBackup();return;}if(e.target.id==='mobile-menu'||e.target.closest('#mobile-menu')){const shell=document.getElementById('app'),sidebar=document.getElementById('sidebar');if(window.innerWidth<=820){sidebar.classList.toggle('open');}else{shell.classList.toggle('sidebar-collapsed');const collapsed=shell.classList.contains('sidebar-collapsed');e.target.closest('#mobile-menu').setAttribute('title',collapsed?t('expandMenu'):t('collapseMenu'));}return;}});document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal();document.getElementById('confirm-root').classList.add('hidden');closeGlobalSearch();}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();document.getElementById('global-search')?.focus();}});document.getElementById('global-search')?.addEventListener('input',e=>{clearTimeout(window.__globalSearchTimer);window.__globalSearchTimer=setTimeout(()=>searchEverywhere(e.target.value),160);});document.getElementById('global-search')?.addEventListener('keydown',e=>{const items=[...document.querySelectorAll('[data-global-result]')];if(e.key==='ArrowDown'||e.key==='ArrowUp'){if(!items.length)return;e.preventDefault();const active=items.findIndex(item=>item.classList.contains('keyboard-active'));const next=e.key==='ArrowDown'?(active+1)%items.length:(active<=0?items.length-1:active-1);items.forEach(item=>item.classList.remove('keyboard-active'));items[next].classList.add('keyboard-active');items[next].scrollIntoView?.({block:'nearest'});return;}if(e.key==='Enter'){const selected=document.querySelector('[data-global-result].keyboard-active')||items[0];if(selected){selected.click();}else{const q=e.target.value.trim();if(q)navigate(state.route,{q});closeGlobalSearch();}}});installBackHandling();}
// Super Admin navigation exists in the page only for a session the database confirmed as Super Admin.
function applySuperAdminUi(snapshot=onlineSnapshot()){
  const allowed=Boolean(snapshot.configured&&snapshot.session&&snapshot.isSuperAdmin);
  // The Super Admin menu is created only for a database-confirmed Super Admin and removed otherwise,
  // so ordinary users never have any trace of it in the page.
  const nav=document.getElementById('main-nav'),existing=document.getElementById('super-admin-nav');
  if(allowed&&nav&&!existing){
    const group=document.createElement('div');group.className='nav-group';group.id='super-admin-nav';
    group.innerHTML='<div class="nav-section-label" data-i18n="superAdmin"></div><button class="nav-link" data-view="super-admin"><span class="nav-icon">★</span><span data-i18n="superAdminDashboard"></span></button>';
    nav.insertBefore(group,nav.firstChild);applyTranslations(group);
  }else if(!allowed&&existing){existing.remove();}
  if(!allowed&&state.route==='super-admin'){closeModal();navigate('dashboard',{},{replace:true});}
  try{updateShell();}catch(error){/* shell not ready yet */}
}
function closeTopLayer(){
  const confirmRoot=document.getElementById('confirm-root');
  if(confirmRoot&&!confirmRoot.classList.contains('hidden')){const no=confirmRoot.querySelector('[data-confirm="no"]');if(no)no.click();else{confirmRoot.classList.add('hidden');confirmRoot.innerHTML='';}return true;}
  const modalRoot=document.getElementById('modal-root');
  if(modalRoot&&!modalRoot.classList.contains('hidden')){closeModal();return true;}
  if(document.body.classList.contains('m-sheet-open')){document.body.classList.remove('m-sheet-open');return true;}
  const menu=document.getElementById('account-menu');
  if(menu&&!menu.classList.contains('hidden')){closeAccountMenu();return true;}
  const results=document.getElementById('global-search-results');
  if(results&&!results.classList.contains('hidden')){closeGlobalSearch();return true;}
  return false;
}
// System/hardware back button: close the top overlay, else go to the previous screen, else ask to press back again to exit.
function installBackHandling(){
  let armed=false,timer=0;
  const arm=()=>{ if(history.state&&(history.state.madrasaApp||history.state.madrasaRoot))return; try{history.replaceState({madrasaRoot:true},'');history.pushState({madrasaApp:true},'');}catch(error){} };
  ['pointerdown','keydown','touchstart'].forEach(name=>document.addEventListener(name,arm,{once:true,capture:true}));
  window.addEventListener('popstate',()=>{
    if(!history.state?.madrasaRoot)return;
    let handled=closeTopLayer();
    if(!handled&&state.history.length){goBack();handled=true;}
    else if(!handled&&state.route!=='dashboard'){navigate('dashboard',{},{replace:true});handled=true;}
    if(handled){history.pushState({madrasaApp:true},'');return;}
    if(armed){armed=false;clearTimeout(timer);history.back();return;}
    armed=true;notify(t('pressBackAgain'),'info');clearTimeout(timer);timer=setTimeout(()=>{armed=false;},2200);history.pushState({madrasaApp:true},'');
  });
}
async function setup(){
  const setupRoot=document.getElementById('setup-overlay');
  const appRoot=document.getElementById('app');
  setLanguage('ps'); applyTranslations(document);
  subscribeOnline(applySuperAdminUi);
  try {
    await db.init();
    state.settings=await db.getSettings();
    if(!state.settings){
      setupRoot.classList.remove('hidden'); appRoot.classList.add('hidden');
      document.getElementById('setup-form').addEventListener('submit',async e=>{
        e.preventDefault();
        const data=Object.fromEntries(new FormData(e.target).entries());
        if(!data.province||!data.district||!data.academicYear){notify(t('invalid'),'error');return;}
        const obs=await import('./observations.js');
        state.settings=await db.saveSettings({id:'app',...data,language:getLanguage(),onlineConfig:getOnlineConfig({}),criteria:obs.defaultCriteria,qualityRanges:obs.defaultQualityRanges,scoringConfig:obs.defaultScoringConfig,criterionMaxScore:obs.defaultScoringConfig.maxScore,maxCriteria:obs.defaultScoringConfig.maxCriteria,observationTotalScore:obs.defaultScoringConfig.totalScore,createdAt:new Date().toISOString()});
        setupRoot.classList.add('hidden'); appRoot.classList.remove('hidden');
        try{await initializeOnline();}catch(error){console.warn('Online initialization skipped',error);}
        updateShell(); await renderCurrent();
        if(onlineSnapshot().configured&&!onlineSnapshot().session) setTimeout(openOnlineLogin,0);
      });
    }else{
      const runtime=getOnlineConfig(state.settings);
      if(runtime.enabled&&(!state.settings.onlineConfig||!state.settings.onlineConfig.supabaseUrl)) state.settings=await db.saveSettings({...state.settings,onlineConfig:runtime},{skipRemote:true});
      try{await initializeOnline();}catch(error){console.warn('Online initialization skipped',error);}
      state.settings=await db.getSettings()||state.settings;
      setLanguage(state.settings.language||'ps'); applyTranslations(document);
      setupRoot.classList.add('hidden'); appRoot.classList.remove('hidden'); updateShell(); await renderCurrent();
      if(onlineSnapshot().configured&&!onlineSnapshot().session) setTimeout(openOnlineLogin,0);
    }
  }catch(error){console.error(error);notify(error.message||t('error'),'error');}
  finally{document.getElementById('app-loading').classList.add('hidden');}
}
installGlobalEvents();setup();
