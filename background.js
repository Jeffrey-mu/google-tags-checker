chrome.runtime.onInstalled.addListener(() => {
  console.log('扩展程序已安装');
});

// 确保扩展程序有正确的权限
chrome.tabs.onActivated.addListener(function(activeInfo) {
  chrome.scripting.executeScript({
    target: { tabId: activeInfo.tabId },
    function: () => console.log('权限检查成功')
  }).catch(err => console.error('权限错误:', err));
}); 
