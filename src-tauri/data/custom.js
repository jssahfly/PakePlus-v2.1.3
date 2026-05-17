window.addEventListener("DOMContentLoaded",()=>{const t=document.createElement("script");t.src="https://www.googletagmanager.com/gtag/js?id=G-W5GKHM0893",t.async=!0,document.head.appendChild(t);const n=document.createElement("script");n.textContent="window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}gtag('js', new Date());gtag('config', 'G-W5GKHM0893');",document.body.appendChild(n)});window.onload = async function () {
  // 已经有 machineId 就不处理
  if (location.href.includes('machineId=')) return;

  // 调用 PakePlus/Tauri 系统 API 获取本机内网 IP
  async function getLocalIpLastSegment() {
    try {
      // PakePlus 内置 tauri API，直接调用（免费、不用付费）
      const net = await window.__TAURI__.networkInterfaces();
      for (const iface of net) {
        // 只找 10.x 网段 IPv4
        if (iface.family === 'IPv4' && iface.address.startsWith('10.')) {
          return iface.address.split('.')[3]; // 返回最后一段
        }
      }
      return null; // 没找到 10.x IP
    } catch (e) {
      console.error('获取IP失败:', e);
      return null;
    }
  }

  const lastSeg = await getLocalIpLastSegment();
  // 只有拿到才跳转，没拿到不做任何事
  if (lastSeg) {
    location.replace(`http://10.110.1.238:3002/machine-desktop/?machineId=${lastSeg}`);
  }
};