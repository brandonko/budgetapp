/*
 * AliExpress MTop order importer.
 * Request and payload behavior is adapted from nrbrook/AliExpress-Order-Export
 * (MIT, Copyright 2026 Nick Brook). See LICENSE and README.md in this directory.
 */

const APP_KEY = "12574478";
const API_ORIGIN = "https://acs.aliexpress.com";
const ORDERS_URL = "https://www.aliexpress.com/p/order/index.html";
const MAX_PAGES = 50;

function md5(input) {
  const source = new TextEncoder().encode(input);
  const paddedLength = Math.ceil((source.length + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(source);
  bytes[source.length] = 0x80;
  const view = new DataView(bytes.buffer);
  const bitLength = source.length * 8;
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);

  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const constants = Array.from(
    { length: 64 },
    (_unused, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) | 0,
  );
  let state = [0x67452301, -0x10325477, -0x67452302, 0x10325476];

  for (let offset = 0; offset < paddedLength; offset += 64) {
    const words = Array.from({ length: 16 }, (_unused, index) =>
      view.getInt32(offset + index * 4, true),
    );
    let [a, b, c, d] = state;
    for (let index = 0; index < 64; index += 1) {
      let value;
      let wordIndex;
      if (index < 16) {
        value = (b & c) | (~b & d);
        wordIndex = index;
      } else if (index < 32) {
        value = (d & b) | (~d & c);
        wordIndex = (5 * index + 1) % 16;
      } else if (index < 48) {
        value = b ^ c ^ d;
        wordIndex = (3 * index + 5) % 16;
      } else {
        value = c ^ (b | ~d);
        wordIndex = (7 * index) % 16;
      }
      const sum = (a + value + constants[index] + words[wordIndex]) | 0;
      const rotated = (sum << shifts[index]) | (sum >>> (32 - shifts[index]));
      [a, d, c, b] = [d, c, b, (b + rotated) | 0];
    }
    state = state.map((value, index) => (value + [a, b, c, d][index]) | 0);
  }

  return state.map((value) =>
    [0, 8, 16, 24]
      .map((shift) => ((value >>> shift) & 0xff).toString(16).padStart(2, "0"))
      .join(""),
  ).join("");
}
if (
  md5("") !== "d41d8cd98f00b204e9800998ecf8427e" ||
  md5("hello") !== "5d41402abc4b2a76b9719d911017c592"
) {
  throw new Error("AliExpress request signer failed its startup self-check.");
}

function parseJsonp(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  return JSON.parse(trimmed.slice(trimmed.indexOf("(") + 1, trimmed.lastIndexOf(")")));
}
function successfulData(payload, name) {
  if ((payload.ret || []).length && !(payload.ret || []).some((item) => String(item).startsWith("SUCCESS"))) {
    throw new Error(`${name} failed: ${(payload.ret || []).join(", ")}`);
  }
  if (!payload.data || typeof payload.data !== "object") throw new Error(`${name} returned no data.`);
  return payload.data;
}
function blockByTag(blocks, tag) { return Object.keys(blocks).find((key) => blocks[key]?.tag === tag); }
function orderDate(value) {
  const parsed = new Date(String(value || ""));
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}
async function token() {
  const cookies = await chrome.cookies.getAll({ domain: "aliexpress.com", name: "_m_h5_tk" });
  const selected = cookies.sort((a,b) => Number(b.domain === ".aliexpress.com") - Number(a.domain === ".aliexpress.com"))[0];
  if (!selected?.value) throw new Error("AliExpress login cookie was not found. Sign in to AliExpress and try again.");
  return selected.value.split("_", 1)[0];
}
async function request(api, data, { method="GET", callback="mtopjsonp1", previous=null }={}) {
  const dataText=JSON.stringify(data); const time=String(Date.now());
  const query=new URLSearchParams({appKey:APP_KEY,t:time,sign:md5(`${await token()}&${time}&${APP_KEY}&${dataText}`),api,v:"1.0",type:method === "GET" ? "originaljsonp" : "originaljson",dataType:"originaljsonp"});
  const options={method,credentials:"include",headers:{}};
  if(method === "GET") { query.set("jsv","2.5.1"); query.set("method","GET"); query.set("timeout","15000"); query.set("data",dataText); query.set("callback",callback); }
  else { query.set("needLogin","true"); query.set("ecode","1"); query.set("post","1"); query.set("isSec","1"); options.headers["Content-Type"]="application/x-www-form-urlencoded"; options.body=new URLSearchParams({data:dataText}); }
  const response=await fetch(`${API_ORIGIN}/h5/${api.toLowerCase()}/1.0/?${query}`,options);
  if(!response.ok) throw new Error(`AliExpress returned HTTP ${response.status}.`);
  return parseJsonp(await response.text());
}
function collectList(payload, orders) {
  const data=successfulData(payload,"order.list"); const blocks=data.data || {}; let metadata={};
  for(const [key,block] of Object.entries(blocks)) { const fields=block?.fields; if(!fields) continue; const tag=block.tag || key; if(tag === "pc_om_list_order" || key.startsWith("pc_om_list_order_")) { const id=String(fields.orderId || ""); if(id) orders.set(id,{id,list:fields,detail:{}}); } else if(tag === "pc_om_list_body") metadata=fields; }
  return metadata;
}
function moreRequest(previous,pageIndex) {
  const payload=successfulData(previous,"order.list"); const blocks=payload.data || {}; const bodyName=blockByTag(blocks,"pc_om_list_body"); const headerName=blockByTag(blocks,"pc_om_list_header_action");
  if(!bodyName || !headerName || !payload.linkage || !payload.hierarchy || !payload.endpoint) throw new Error("AliExpress pagination state was incomplete.");
  const selected=structuredClone({[bodyName]:blocks[bodyName],[headerName]:blocks[headerName]}); selected[bodyName].fields.pageIndex=pageIndex; selected[bodyName].fields.pageSize=10;
  return {params:JSON.stringify({data:JSON.stringify(selected),linkage:JSON.stringify(payload.linkage),hierarchy:JSON.stringify(payload.hierarchy),endpoint:JSON.stringify(payload.endpoint),operator:bodyName}),shipToCountry:"US",_lang:"en_US"};
}
function collectDetail(payload, order) {
  const blocks=successfulData(payload,"order.detail").data || {};
  for(const [key,block] of Object.entries(blocks)) { if(!block?.fields) continue; const tag=String(block.tag || key).replace(/\d+$/,"",).replace(/_$/,"" ); order.detail[tag]=block.fields; }
}
function normalize(order) {
  const products=order.detail.detail_product_block?.productVOList || order.list.orderLines || [];
  const detailTotal=order.detail.detail_order_price_block?.totalPrice?.value;
  return {orderId:order.id,orderDate:orderDate(order.list.orderDateText || order.detail.detail_simple_order_info_component?.orderCreatTime),status:String(order.list.statusText || ""),currency:String(order.list.currencyCode || products[0]?.currencyCode || "USD"),total:String(order.list.totalPriceText || detailTotal || ""),storeName:String(order.list.storeName || ""),items:products.map((item)=>({title:String(item.itemTitle || ""),price:String(item.itemPriceText || ""),quantity:item.quantity || 1,orderLineId:String(item.orderLineId || "")}))};
}

export async function exportAliExpressOrders({startDate,endDate,onProgress,isCancelled}) {
  await fetch(ORDERS_URL,{credentials:"include"});
  const orders=new Map(); let previous=null; let lastReported=null;
  for(let page=1;page<=MAX_PAGES;page++) {
    if(isCancelled()) throw new Error("AliExpress import cancelled.");
    const before=orders.size;
    const data=page===1 ? {statusTab:null,renderType:"init",clientPlatform:"pc",shipToCountry:"US",_lang:"en_US",timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone} : moreRequest(previous,page);
    previous=await request("mtop.aliexpress.trade.buyer.order.list",data,{method:page===1?"GET":"POST"});
    const metadata=collectList(previous,orders); const reported=Number(metadata.pageIndex);
    await onProgress(Math.min(45,3+page*3),`Collecting AliExpress order list (page ${page})…`);
    const dates=[...orders.values()].map((value)=>orderDate(value.list.orderDateText)).filter(Boolean);
    if(orders.size===before || (Number.isFinite(reported) && lastReported !== null && reported<=lastReported) || !metadata.hasMore || (dates.length && dates.sort()[0] < startDate)) break;
    if(Number.isFinite(reported)) lastReported=reported;
  }
  const selected=[...orders.values()].filter((value)=>{const date=orderDate(value.list.orderDateText); return date && date>=startDate && date<=endDate;});
  for(let index=0;index<selected.length;index++) {
    if(isCancelled()) throw new Error("AliExpress import cancelled.");
    const order=selected[index];
    collectDetail(await request("mtop.aliexpress.trade.buyer.order.detail",{tradeOrderId:order.id,clientPlatform:"pc",shipToCountry:"US",_lang:"en_US",timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}),order);
    await onProgress(45+Math.floor(((index+1)/Math.max(selected.length,1))*48),`Fetching AliExpress item details ${index+1}/${selected.length}…`);
  }
  return JSON.stringify({source:"aliexpress-mtop",orders:selected.map(normalize)});
}
