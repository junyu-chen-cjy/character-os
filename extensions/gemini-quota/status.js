Promise.all([chrome.storage.local.get(['status','checkedAt']),chrome.alarms.getAll()]).then(([status,alarms])=>{
  document.getElementById('status').textContent=JSON.stringify({
    status:status.status,checkedAt:status.checkedAt&&new Date(status.checkedAt).toISOString(),
    alarms:alarms.map(a=>({name:a.name,next:new Date(a.scheduledTime).toISOString(),minutes:a.periodInMinutes})),
  },null,2);
});
