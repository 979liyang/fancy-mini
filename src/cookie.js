let cookie = {
  cookieStorageName: 'zz_wa_cookie',

  cookieStr: '',

  getCookieStr(){
    // 取cookie操作先尝试从内存数据中取
    if(this.cookieStr)return this.cookieStr;
    this.cookieStr = wx.getStorageSync(this.cookieStorageName);
    return this.cookieStr;
  },

  get(key){
    let cookieStr = this.getCookieStr();
    let cookieArr = cookieStr.split(';');

    for(let i = 0; i < cookieArr.length; i++){
      if(cookieArr[i].indexOf(key + '=') === 0){
        // 注意不要直接用匹配split('='), ppu等含=的不规则cookie会出错
        let index = cookieArr[i].indexOf('=');
        let val = cookieArr[i].substring(index + 1);
        return val;
      }
    }
    return '';
  },


  set(key, val){
    val = String(val);
    if(key == 'PPU' && val[0] != '"' && val!=='')val = '"' + val + '"';

    let cookieStr = this.getCookieStr();
    let cookieArr = cookieStr.split(';');
    for(let i = 0; i < cookieArr.length; i++){
      if(cookieArr[i].indexOf(key + '=') === 0){
        // 注意不要直接用匹配split('='), ppu等含=的不规则cookie会出错
        let oldVal = this.get(key);
        cookieStr = cookieStr.replace(key + '=' + oldVal + ';', '');
        break;
      }
    }

    cookieStr += key + '=' + val + ';';
    this.cookieStr = cookieStr;
    this.stableSetStorage(this.cookieStorageName, cookieStr);
  },

  stableSetStorage(key, data, retry=true){
    wx.setStorage({
      key,
      data,
      fail: ()=>{
        if(retry)this.stableSetStorage(key, data, false);
      }
    });
  },

  setCookie(string){
    string = Array.isArray(string) ? string[0] : string
    let stringArr = string.split(';');
    for(let i = 0; i < stringArr.length; i++){
      let item = stringArr[i].trim();
      let ignore = /^(expires\=|domain\=|path\=|secure|Max-Age=|Version=)/i;
      if(ignore.test(item))continue;
      let index = item.indexOf('=');
      let key = item.substring(0, index);
      let val = item.substring(index + 1);

      this.set(key, val);
    }
  },

  getCookie(){
    return this.getCookieStr();
  }

}

export default cookie
