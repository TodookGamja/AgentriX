const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const ROOT = path.resolve(".");
const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/lib/blackboardDispatch.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:api});
const task=(id,status)=>({taskId:id,agentId:"forge",status});
const mail=(subject,body="완료")=>({from:"forge",to:"pm",subject,body});
function autoReports(mails,tasks,prior=[]){
  const mailSeen=new Set(prior);
  for(const k of api.resultMailTaskKeys(mails,tasks,"pm")) mailSeen.add(k);
  const reports=[];
  for(const t of tasks){
    if(t.status!=="done") continue;
    if(mailSeen.has(`${t.taskId}:${t.agentId}`)) continue;
    reports.push(`report:${t.taskId}:${t.agentId}`);
  }
  return {reports, mailSeen:[...mailSeen]};
}
test("① mid×3 then ✅ → auto report exactly 1",()=>{
  const mids=["T4_1 중간 결과","T4_1 조건부 완료 승인 요청","T4_1 실측 결과, 결정 부탁"].map(s=>mail(s,"진행중"));
  const mid=autoReports(mids,[task("T4_1","start")]);
  assert.deepEqual(mid.mailSeen,[]);
  const after=autoReports(mids,[task("T4_1","done")],"pm",mid.mailSeen);
  assert.deepEqual(after.reports,["report:T4_1:forge"]);
});
test("② normal result then ✅ → duplicate 0",()=>{
  const mails=[mail("T4_1 결과","완료")];
  const mid=autoReports(mails,[task("T4_1","start")]);
  assert.deepEqual(mid.mailSeen,["T4_1:forge"]);
  assert.deepEqual(autoReports(mails,[task("T4_1","done")],"pm",mid.mailSeen).reports,[]);
});
test("③ result subject with 실측 → treat as non-result → auto 1 (dup≤1, no omit)",()=>{
  const mails=[mail("T4_1 실측 결과","최종 완료")];
  assert.equal(api.hasTaskResultMail(mails,"T4_1","forge","pm"),false);
  assert.deepEqual(autoReports(mails,[task("T4_1","done")]).reports,["report:T4_1:forge"]);
});
test("④ question/request exclusion regression",()=>{
  assert.equal(api.hasTaskResultMail([mail("T4_1 완료 문의","결과")],"T4_1","forge","pm"),false);
  assert.equal(api.hasTaskResultMail([mail("T4_1 완료 요청","결과")],"T4_1","forge","pm"),false);
  assert.equal(api.hasTaskResultMail([mail("T4_1 질문","완료 결과")],"T4_1","forge","pm"),false);
  assert.equal(api.hasTaskResultMail([mail("T4_1 결과","완료")],"T4_1","forge","pm"),true);
  assert.deepEqual(autoReports([mail("T4_1 완료 문의")],[task("T4_1","done")]).reports,["report:T4_1:forge"]);
});
