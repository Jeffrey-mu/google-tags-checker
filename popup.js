document.addEventListener('DOMContentLoaded', function() {
  if (!chrome.scripting) {
    document.getElementById('adList').innerHTML = 
      '<div class="no-ads">扩展程序需要访问权限才能运行</div>';
    return;
  }

  chrome.tabs.query({
    active: true,
    currentWindow: true
  }, function(tabs) {
    if (!tabs[0]?.id) {
      document.getElementById('adList').innerHTML = 
        '<div class="no-ads">无法在此页面运行扩展程序</div>';
      return;
    }

    // 获取页面源代码
    fetch(tabs[0].url)
      .then(response => response.text())
      .then(sourceCode => {
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: findGoogleAds,
          args: [sourceCode]
        })
        .then(results => {
          if (results && results[0]) {
            const adInfo = results[0].result;
            displayAdInfo(adInfo);
          }
        })
        .catch(err => {
          console.error('执行脚本错误:', err);
          document.getElementById('adList').innerHTML = 
            `<div class="no-ads">检测失败: ${err.message}</div>`;
        });
      });
  });
});

function findGoogleAds(sourceCode) {
  const ads = {
    count: 0,
    details: [],
    ga4: {
      found: false,
      measurementId: null,
      code: null
    }
  };

  // 查找 GA4 代码
  // 1. 查找 gtag.js 脚本
  const ga4ScriptRegex = /<script[^>]*src=['"]https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-[^'"]+['"][^>]*>/g;
  let ga4Match = ga4ScriptRegex.exec(sourceCode);
  if (ga4Match) {
    const measurementIdMatch = ga4Match[0].match(/[?&]id=(G-[^'"&]+)/);
    if (measurementIdMatch) {
      ads.ga4.found = true;
      ads.ga4.measurementId = measurementIdMatch[1];
      ads.ga4.code = ga4Match[0];
    }
  }

  // 2. 查找 GA4 配置代码
  const ga4ConfigRegex = /gtag\('config',\s*['"]G-[^'"]+['"]/g;
  const configMatch = ga4ConfigRegex.exec(sourceCode);
  if (configMatch) {
    const measurementIdMatch = configMatch[0].match(/['"]G-[^'"]+['"]/);
    if (measurementIdMatch) {
      ads.ga4.found = true;
      ads.ga4.measurementId = measurementIdMatch[0].replace(/['"]/g, '');
      if (!ads.ga4.code) {
        // 查找包含此配置的完整 script 标签
        const scriptRegex = new RegExp(`<script[^>]*>[^<]*${configMatch[0]}[^<]*</script>`);
        const scriptMatch = sourceCode.match(scriptRegex);
        if (scriptMatch) {
          ads.ga4.code = scriptMatch[0];
        }
      }
    }
  }

  // 3. 查找 Google Tag 代码
  const googleTagRegex = /<script[^>]*src=['"]https:\/\/www\.googletagmanager\.com\/gtm\.js[^'"]*['"][^>]*>/g;
  let gtmMatch = googleTagRegex.exec(sourceCode);
  if (gtmMatch && !ads.ga4.found) {
    // 检查是否包含 GA4 配置
    const gtmConfigRegex = /dataLayer\.push\(\{[^}]*'G-[^']+'/;
    const gtmConfigMatch = sourceCode.match(gtmConfigRegex);
    if (gtmConfigMatch) {
      const measurementIdMatch = gtmConfigMatch[0].match(/G-[^']+/);
      if (measurementIdMatch) {
        ads.ga4.found = true;
        ads.ga4.measurementId = measurementIdMatch[0];
        ads.ga4.code = gtmMatch[0];
      }
    }
  }

  // 原有的广告代码检测部分保持不变...
  // 查找所有 script 标签内容
  const scriptRegex = /<script[^>]*>([\s\S]+?)<\/script>/g;
  let scriptMatch;
  
  // 查找 GPT 广告定义
  const gptSlots = new Map();
  while ((scriptMatch = scriptRegex.exec(sourceCode)) !== null) {
    const fullScript = scriptMatch[0];
    const scriptContent = scriptMatch[1];
    
    // 检查是否包含 GPT 广告定义
    if (scriptContent.includes('googletag.defineSlot')) {
      const defineSlotRegex = /defineSlot\(['"]([^'"]+)['"][^)]+\)/g;
      let defineMatch;
      
      while ((defineMatch = defineSlotRegex.exec(scriptContent)) !== null) {
        const adPath = defineMatch[1];
        const divIdMatch = scriptContent.match(/['"]div-gpt-ad-[\w-]+['"]/);
        
        if (divIdMatch) {
          const divId = divIdMatch[0].replace(/['"]/g, '');
          gptSlots.set(divId, {
            adPath: adPath,
            defineScript: fullScript
          });
        }
      }
    }
  }

  // 查找广告容器 div
  const divRegex = /<div[^>]+id=['"]div-gpt-ad-[\w-]+['"][^>]*>[\s\S]*?<\/div>/g;
  let divMatch;
  while ((divMatch = divRegex.exec(sourceCode)) !== null) {
    const containerHtml = divMatch[0];
    const idMatch = containerHtml.match(/id=['"]([^'"]+)['"]/);
    if (idMatch && gptSlots.has(idMatch[1])) {
      const slot = gptSlots.get(idMatch[1]);
      slot.container = containerHtml;
    }
  }

  // 收集广告信息
  for (const [divId, slot] of gptSlots) {
    ads.details.push({
      type: 'Google Publisher Tag 广告位',
      id: slot.adPath,
      divId: divId,
      code: `${slot.defineScript}\n\n${slot.container || '未找到容器'}`
    });
  }

  // 查找 AdSense 代码
  const adsenseScriptRegex = /<script[^>]+src=['"][^'"]*(?:pagead2\.googlesyndication\.com|adsbygoogle\.js)[^'"]*['"][^>]*>/g;
  while ((scriptMatch = adsenseScriptRegex.exec(sourceCode)) !== null) {
    ads.details.push({
      type: 'AdSense Script',
      source: scriptMatch[0].match(/src=['"]([^'"]+)['"]/)[1],
      code: scriptMatch[0]
    });
  }

  // 查找 AdSense 容器
  const adsenseContainerRegex = /<ins[^>]+class=['"][^'"]*adsbygoogle[^'"]*['"][^>]*>[\s\S]*?<\/ins>/g;
  while ((scriptMatch = adsenseContainerRegex.exec(sourceCode)) !== null) {
    ads.details.push({
      type: 'AdSense Container',
      code: scriptMatch[0]
    });
  }

  ads.count = ads.details.length;
  return ads;
}

function displayAdInfo(adInfo) {
  // 显示 GA4 状态
  const ga4StatusElement = document.getElementById('ga4Status');
  if (adInfo.ga4.found) {
    ga4StatusElement.textContent = `已安装 (${adInfo.ga4.measurementId || '未知ID'})`;
    ga4StatusElement.className = 'ga4-status ga4-found';
  } else {
    ga4StatusElement.textContent = '未安装';
    ga4StatusElement.className = 'ga4-status ga4-not-found';
  }

  // 更新广告数量
  document.getElementById('adCount').textContent = adInfo.count;
  
  // 更新广告列表
  const adListElement = document.getElementById('adList');
  adListElement.innerHTML = '';
  
  if (adInfo.count === 0) {
    adListElement.innerHTML = '<div class="no-ads">未发现Google广告代码</div>';
    return;
  }
  
  adInfo.details.forEach((ad, index) => {
    const adElement = document.createElement('div');
    adElement.className = 'ad-item';
    
    const headerHtml = `
      <div class="ad-item-header">
        <span class="ad-number">#${index + 1}</span>
        <span class="ad-type">${ad.type}</span>
      </div>
    `;

    let infoHtml = '';
    if (ad.source) infoHtml += `<div class="ad-info"><span class="info-label">来源:</span> ${ad.source}</div>`;
    if (ad.id) infoHtml += `<div class="ad-info"><span class="info-label">广告位:</span> ${ad.id}</div>`;
    if (ad.divId) infoHtml += `<div class="ad-info"><span class="info-label">容器ID:</span> ${ad.divId}</div>`;
    
    const codeHtml = `
      <div class="code-container">
        <div class="code-header">
          <span class="code-type">广告代码</span>
          <button class="copy-btn" data-code="${encodeURIComponent(ad.code)}">复制代码</button>
        </div>
        <pre><code>${ad.code ? ad.code.replace(/</g, '&lt;').replace(/>/g, '&gt;') : '无代码'}</code></pre>
      </div>
    `;
    
    adElement.innerHTML = headerHtml + infoHtml + codeHtml;
    
    // 添加复制功能
    const copyBtn = adElement.querySelector('.copy-btn');
    copyBtn.addEventListener('click', function() {
      const code = decodeURIComponent(this.getAttribute('data-code'));
      navigator.clipboard.writeText(code).then(() => {
        this.classList.add('copy-success');
        this.textContent = '已复制';
        setTimeout(() => {
          this.classList.remove('copy-success');
          this.textContent = '复制代码';
        }, 2000);
      }).catch(err => {
        console.error('复制失败:', err);
        this.textContent = '复制失败';
        setTimeout(() => {
          this.textContent = '复制代码';
        }, 2000);
      });
    });
    
    adListElement.appendChild(adElement);
  });
} 
