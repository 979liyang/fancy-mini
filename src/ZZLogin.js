/**
 * 登录模块，在小程序中登录转转账号
 * 功能及使用参见文档：/docs/登录模块.md
 * 注意：名称以_开头的定义为内部变量，请勿引用，非_开头的才是对外接口
 */
import cookie from './cookie';
import {wxPromise, wxResolve} from 'fancy-mini/lib/wxPromise';
import {mergingStep} from 'fancy-mini/lib/decorators';

/**
 * 登录模块命名空间
 */
@requireConfig //确保调用API时已完成项目信息配置
class ZZLogin {
  static _userInfo = JSON.parse(wx.getStorageSync("userInfo") || '{}');     //微信用户信息
  static _zzUserInfo = JSON.parse(wx.getStorageSync("zzUserInfo") || '{}'); //转转用户信息

  //配置参数，不同小程序可调用config方法自定义覆盖
  static _config = {
    /**
     * 小程序编号，用于区分不同的小程序，由rd指定
     */
    source: '',
    t: '', //同source

    /**
     * 提示文案，用户曾经拒绝授权导致登录失败时会弹窗提醒并打开授权面板，使其可以重新授权
     * 此处为弹窗提醒的文案内容
     */
    denyTip: '小程序需要您的授权才能提供更好的服务哦~',
    /**
     * 校验函数，根据后端接口返回内容判断后端登录态是否已过期
     * 用于处理前后端session有效时长不一致等问题
     * @param resp    接口返回内容
     * @param options 调用接口的参数
     * @return {boolean}  是否登录态失效
     */
    apiAuthFail(resp, options){
      return (
        (resp.errMsg && resp.errMsg.includes('请登录'))
        || (options.url.includes('/aaa/') && resp.respCode == -1)      //平台接口，PPU无效或过期
        || (options.url.includes('/bbb/') && resp.respCode == -2)  //xxx业务接口，PPU无效或过期
        || (options.url.includes('/ccc/') && resp.respCode == -3)  //xxx业务接口，微信session_key无效或过期
      );
    },
    /**
     * 注册到组件上的成员属性/方法列表
     * key为注册到组件实例上的方法名称
     * value为对应的ZZLogin方法名称，保留字'*this'表示ZZLogin自身
     */
    installProps: {
      '$loginCenter': '*this',
      '$login': 'login',
      '$http': 'request',
      '$httpWithLogin': 'requestWithLogin',
      '$logout': 'logout',
      '$reLogin': 'reLogin',
    },
    /**
     * 注册全局this属性处理函数
     */
    registerToThisHandler: null,

    /**
     * 钩子函数，发请求之前调用
     * @param options 请求参数，格式同wx.request
     * @return {Object} 若有返回值，则以返回值覆盖原参数发出请求，否则使用原参数对象发出请求
     */
    beforeRequest: null,
    /**
     * 底层网络API，格式同wx.request
     */
    requester: wx.request,
    /**
     * 网络异常重试机制，重试成功应resolve(res)，重试失败则reject(res)
     * @param {{
     *    res: Object,
     *    options: Object,
     *    resolve,
     *    reject
     * }}
     */
    requestFailRecoverer: null,

    /**
     * 登录失败时调用
     * @param {Object} res 登录结果，格式形如：{
     *    code: -3,   //状态码，0为成功
     *    errMsg:'zz login api failed...',  //详细错误日志，debug用
     *    toastMsg: '您的账号存在安全风险，请到58电脑端登录解除'  //（可选）用户话术，提示失败原因
     * }
     */
    loginFailed(res){
      wx.showToast({
        title: res.toastMsg || '登录失败',
        image: '/images/tipfail.png',
        duration: 3000
      });
    },

    /**
     * 入口信息，其中的channel字段会用于后端埋点
     */
    entryInfo: {},

    /**
     * 自定义用户授权逻辑
     * @return {Promise<Object>} 格式同wx.getUserInfo，或返回null使用默认授权逻辑
     */
    userAuthHandler: null,
    /**
     * 自定义用户拒绝授权处理逻辑
     * @param {string} denyTip 默认提示文案
     * @return {Promise<Object>} 格式同wx.openSetting，或返回null使用默认处理逻辑
     */
    userDenyHandler: null,
    /**
     * 钩子函数，获取用户授权信息失败时触发
     * @param {string} type  失败类型： deny-用户拒绝授权 | unknown-其它原因
     */
    onUserAuthFailed: null,
    /**
     * 钩子函数，获取用户授权信息成功时触发
     */
    onUserAuthSucceeded: null,

    /**
     * 登录流程自定义附加步骤，为一个处理函数，会在正常登录流程执行成功时调用，并根据其处理结果生成最终登录结果
     *  @return {Promise<Object>} res 处理结果，格式形如：{
     *    succeeded: true,   //是否成功
     *    errMsg:'zz login api failed...',  //详细错误日志，debug用
     *    toastMsg: '您的账号存在安全风险，请到58电脑端登录解除'  //（若有）用户话术，提示失败原因
     * }
     */
    loginStepAddOn: null,
  };

  /**
   * 清除登录信息
   * @private
   */
  static _clearLoginInfo(){
    ZZLogin._zzUserInfo = {};
    cookie.set('uid', '');
    cookie.set('PPU', '');
    wx.setStorage({
      key: 'userInfo',
      data: ''
    });
    wx.setStorage({
      key: 'zzUserInfo',
      data: ''
    });
  }

  static _loginSteps = {
    /**
     * 微信登录：调用微信相关API，获取用户标识（openid，某些情况下也能获得unionid）
     * @return {Promise<Object>} 微信用户标识
     */
    @mergingStep //步骤并合修饰器，避免公共步骤并发重复进行
    async wxLogin(){
      return await wxResolve.login();
    },
    /**
     * 静默授权：对于老用户，根据微信用户标识从数据库中获得用户信息
     * @return {Promise<Object>} 微信用户信息、转转账户信息
     */
    @mergingStep
    async silentLogin({wxLoginRes}){
      let mpLoginRes = await ZZLogin.request({
        url: 'https://xxx/mpSilenceLogin', //静默登录接口，根据code解码出openid，使用openid查找用户信息并返回
        data: {
          code: wxLoginRes.code,
          source: ZZLogin._config.source,
        },
        method: "POST",
      });

      if (!(mpLoginRes.respCode == 0 && mpLoginRes.respData.status == 0))
        return {succeeded: false};

      return {
        succeeded: true,
        userInfo: mpLoginRes.respData.userInfo,  //昵称、头像等
        zzUserInfo: mpLoginRes.respData.zzUserInfo, //uid、ppu
      }
    },
    /**
     * 获取微信用户信息：调用微信相关API，请求用户授权访问个人信息
     * @return {Promise<Object>} 微信用户信息
     */
    @mergingStep
    async requestUserInfo(){
      //获取用户信息；支持项目自定义交互过程，默认直接出授权弹窗
      let userInfoRes = (ZZLogin._config.userAuthHandler && await ZZLogin._config.userAuthHandler.call(this)) || (await wxResolve.getUserInfo({
        withCredentials: true,
      }));

      if (!/ok/.test(userInfoRes.errMsg)) {  //若用户曾经拒绝授权，导致获取用户信息失败，则提示授权并重试
        let settingRes = ZZLogin._config.userDenyHandler && await ZZLogin._config.userDenyHandler.call(this, {denyTip: ZZLogin._config.denyTip}); //支持项目自定义交互
        if (!settingRes) { //使用默认交互
          await wxPromise.showModal({ //提示用户重新授权
            title: '登录失败',
            content: ZZLogin._config.denyTip,
            showCancel: false,
            confirmText: '知道了',
          });
          settingRes = await wxResolve.openSetting(); //打开权限面板
        }

        if (!(settingRes.errMsg.includes('ok') && settingRes.authSetting["scope.userInfo"])) {//若用户依然没有授权用户信息，则直接返回
          ZZLogin._config.onUserAuthFailed && ZZLogin._config.onUserAuthFailed.call(this, {type: 'deny', userInfoRes, settingRes});
          return {succeeded: false, errMsg: 'user refused to grant permission of getUserInfo'};
        }else {  //否则，再次尝试获取用户信息
          userInfoRes = await wxResolve.getUserInfo({
            withCredentials: true,
          });
        }
      }

      if (!/ok/.test(userInfoRes.errMsg)) { //获取用户信息失败，返回
        ZZLogin._config.onUserAuthFailed && ZZLogin._config.onUserAuthFailed.call(this, {type: 'unknown', userInfoRes});
        return {succeeded: false, errMsg: 'wx.getUserInfo failed:' + JSON.stringify(userInfoRes)};
      }
      
      ZZLogin._config.onUserAuthSucceeded && ZZLogin._config.onUserAuthSucceeded.call(this);
      userInfoRes.succeeded = true;
      return userInfoRes;
    },
    /**
     * 转转登录：根据微信用户标识&信息，注册/登录转转账户
     * @return {Promise<Object>} 转转账户信息
     */
    @mergingStep
    async zzLogin({wxLoginRes, userInfoRes}){
      let zzLoginRes = await ZZLogin.request({
        url: 'https://xxx/login',
        data: {
          code: wxLoginRes.code,
          encryptedData: userInfoRes.encryptedData,
          iv: userInfoRes.iv,
          source: ZZLogin._config.source,
          channelId: ZZLogin._config.entryInfo.channel,
        },
        method: "POST",
      });
      if (zzLoginRes.respCode != 0) //转转登录失败，返回
        return {succeeded: false, errMsg:'zz login api failed:'+JSON.stringify(zzLoginRes), toastMsg: zzLoginRes.respData&&zzLoginRes.respData.errMsg};
      
      return {
        succeeded: true,
        zzUserInfo: zzLoginRes.respData
      };
    },
    /**
     * 保存登录信息
     * @param {Object} userInfo 微信用户信息
     * @param {Object} zzUserInfo 转转账户信息
     */
    saveInfo({userInfo, zzUserInfo}){
      Object.assign(ZZLogin._userInfo, userInfo); //记录微信用户信息
      Object.assign(ZZLogin._zzUserInfo, zzUserInfo);  //记录转转用户信息

      //保存用户信息
      wx.setStorage({
        key: 'userInfo',
        data: JSON.stringify(ZZLogin._userInfo)
      });
      wx.setStorage({
        key: 'zzUserInfo',
        data: JSON.stringify(ZZLogin._zzUserInfo)
      });

      // 写入cookie
      cookie.set('uid', ZZLogin._zzUserInfo.uid);
      cookie.set('PPU', '"' + ZZLogin._zzUserInfo.ppu + '"');
      ZZLogin._zzUserInfo.token && cookie.set('tk', ZZLogin._zzUserInfo.token);
      
      
    },

    /**
     * 支持使用方配置自定义附加步骤，会在正常登录流程执行成功时调用，并根据其处理结果生成最终登录结果
     * @return {Promise<*>}
     */
    async addOn(){
      if (!ZZLogin._config.loginStepAddOn)
        return {succeeded: true};
      
      let stepRes = await ZZLogin._config.loginStepAddOn();
      
      if (typeof stepRes !== "object"){
        console.error('[login] loginStepAddOn shall return an object, something like "{succeeded: true, errMsg:\'debug detail\', toastMsg: \'alert detail\'}", yet got return value:', stepRes);
        stepRes = {succeeded: false};
      }
      
      return stepRes;
    },

    /**
     * 登录信息获取完毕后续步骤集合
     * @param userInfo
     * @param zzUserInfo
     * @return {Promise<*>}
     */
    async afterFetchInfoPack({userInfo, zzUserInfo}){
      ZZLogin._loginSteps.saveInfo({userInfo,zzUserInfo});
      let addOnRes = await ZZLogin._loginSteps.addOn();
      
      if (!addOnRes.succeeded) {
        ZZLogin._clearLoginInfo();
        return {code: -4, errMsg: addOnRes.errMsg||'add on failed', toastMsg: addOnRes.toastMsg};
      }
      
      return {code: 0, errMsg: 'ok'};
    }
  }
  /**
   * 登录
   * 入参同login函数
   * @return {Object} res 登录结果，格式形如：{code:0, errMsg:'ok'}
   * @private
   */
  static async _login(options){
    //若已登录且不是强制模式，直接返回
    if (options.mode!=='force' && (await ZZLogin.checkLogin()))
      return {code:0, errMsg:'ok'};

    let steps = ZZLogin._loginSteps;

    //微信登录
    let wxLoginRes = await steps.wxLogin();
    if (!wxLoginRes.succeeded)
      return { code: -1, errMsg: wxLoginRes.errMsg};

    //尝试静默登录
    let silentRes = await steps.silentLogin({wxLoginRes});
    if (silentRes.succeeded) { //静默登录成功，保存登录信息，结束；否则继续尝试授权登录
      return steps.afterFetchInfoPack({
        userInfo: silentRes.userInfo,
        zzUserInfo: silentRes.zzUserInfo,
      });
    }
    
    if (options.mode==='silent') //静默模式，只尝试静默登录，不触发授权弹窗；不管成功失败都不影响页面功能和后续接口调用
      return {code: 0, errMsg: 'login failed silently'};
    
    //尝试授权登录
    
    wxLoginRes = await steps.wxLogin(); //重新获取code，此前的code已被静默授权使用，不能复用
    
    //请求授权微信用户信息
    let userInfoRes = await steps.requestUserInfo.call(this);
    if (!userInfoRes.succeeded)
      return {code: -2, errMsg: userInfoRes.errMsg};
    
    // 登录/注册转转账户
    let zzLoginRes = await steps.zzLogin({wxLoginRes, userInfoRes});
    if (!zzLoginRes.succeeded)
      return {code: -3, errMsg: zzLoginRes.errMsg, toastMsg: zzLoginRes.toastMsg};
    
    //保存登录信息
    return steps.afterFetchInfoPack({
      userInfo: userInfoRes.userInfo,
      zzUserInfo: zzLoginRes.zzUserInfo,
    });
  }

  /**
   * 登录，捕获错误并打印失败原因，便于定位登录失败原因
   * 功能、参数、返回值同 _login
   * @return {*}
   * @private
   */
  static async _loginWithErrLog(options){
    let loginRes = {};
    try {
      loginRes = await ZZLogin._login.call(this, options);
      if (!loginRes || loginRes.code!=0) {
        loginRes = loginRes&&loginRes.code ? loginRes : {code:-100, errMsg: 'login failed'};
        console.error('[login failed]:', loginRes);
      }
    } catch (e){
      loginRes = {code: -500, errMsg:'internal error'};
      console.error('[login failed] uncaught error:',e && e.message, e); //真机下不支持打印错误栈，导致e打印出来是个空对象；故先单独打印一次e.message
    };
    loginRes.code!=0 && typeof ZZLogin._config.loginFailed==="function" && ZZLogin._config.loginFailed.call(this, loginRes);
    return loginRes;
  }

  /**
   * 配置参数
   * @param {Object} options 参数，可配置项参见_config相关注释
   */
  static config(options){
    let adjustedOpts = Object.assign({}, options);

    //提供了source，未提供t时，取source作为t
    adjustedOpts.t = adjustedOpts.t==undefined ? adjustedOpts.source : adjustedOpts.t;

    //登录态校验函数，以追加的形式进行配置，不覆盖原有判断逻辑
    if (adjustedOpts.apiAuthFail){
      let oriAuth = ZZLogin._config.apiAuthFail;
      let newAuth = adjustedOpts.apiAuthFail;
      adjustedOpts.apiAuthFail = function(...args){
        return newAuth.apply(this, args) || oriAuth.apply(this, args);
      }
    }

    Object.assign(ZZLogin._config, adjustedOpts);
  }

  /**
   * 安装
   */
  static install(options){
    if (options)
      ZZLogin.config(options);

    if (!ZZLogin._config.source){
      console.error('[ZZLogin] 注册失败，请检查参数配置是否正确');
      return;
    }

    //写入cookie
    cookie.set('uid', ZZLogin._zzUserInfo.uid);
    cookie.set('PPU', '"' + ZZLogin._zzUserInfo.ppu + '"');
    cookie.set('t', ZZLogin._config.t);

    //将模块相关方法注册到组件实例上
    ZZLogin._config.registerToThisHandler && ZZLogin._config.registerToThisHandler(ZZLogin, ZZLogin._config.installProps);
  }

  /**
   * 检查是否登录
   * @return {boolean}  是否登录
   */
  static async checkLogin(){
    //微信session过期、后端session_key过期、ppu过期等情况改为惰性处理，此处不做判断
    //这些情况接口会返回相应的错误码，彼时再清空信息重新登录，从而节省每次的查询开销
    return !!ZZLogin._zzUserInfo.ppu;
  }

  /**
   *登录
   * @param {Object} options 登录选项
   * @param {Function} options.callback, 兼容起见支持回调，但更建议以Promise方式使用
   * @param {string} options.mode 登录模式
   *    common - 通用模式，适合大部分页面场景
   *    silent - 静默模式，适合免打扰场景：只尝试静默登录，不触发授权弹窗；不管成功失败都不影响页面功能和后续接口调用
   *    force - 强制模式，适合解码场景：刷新微信session，保证解码加密数据时session不过期
   *    
   * @return {Promise<Object>} res 登录结果，格式形如：{
     *    code: -3,   //状态码，0为成功
     *    errMsg:'zz login api failed...',  //详细错误日志，debug用
     *    toastMsg: '您的账号存在安全风险，请到58电脑端登录解除'  //（若有）用户话术，提示失败原因
     * }
   */
  static async login(options){
    //参数处理
    if (typeof options === "function") //兼容旧版入参格式
      options = {callback: options};
    
    let defaultOpts = {
      callback: null,
      mode: 'common',
    };
    options = Object.assign(defaultOpts, options);
    
    //登录
    let loginRes = await ZZLogin._loginWithErrLog.call(this, options);

    //结果处理
    options.callback && options.callback(loginRes);
    return loginRes;
  }

  /**
   *退出登录
   * @return {Object} res 退出登录结果，格式形如：{code:0, errMsg:'ok'}
   */
  static async logout(){
    ZZLogin._clearLoginInfo();
    return {code: 0};
  }

  /**
   * 重新登录
   * @return {Object} 登录结果，格式形如：{code:0, errMsg:'ok'}
   */
  static async reLogin(){
    await ZZLogin.logout();
    return await ZZLogin.login.call(this);
  }

  /**
   * http请求，功能同wx.request，封装了cookie逻辑，并修缮了"POST"使用
   * 兼容起见，支持options中success、fail、complete回调，但更建议以Promise方式使用
   * @param {Object}options 参数，格式同wx.request
   * @param {boolean} requestDetail  是否关注请求详情， true-返回完整请求（状态码、头部、数据等），false-直接返回接口数据
   * @return {Promise} 返回结果，resolve入参为接口返回内容res.data, reject入参为请求结果res
   */
  static async request(options, {requestDetail=false}={}){
    if (typeof ZZLogin._config.beforeRequest === "function")
      options = ZZLogin._config.beforeRequest.call(this, options) || options;

    return new Promise(async (resolve,reject)=>{
      await ZZLogin._ensuringExistingToken();
      ZZLogin._execRequest.call(this, options, requestDetail, resolve, reject);
    })
  }

  /**
   * token机制，请求发起前，先确保本地有token，如果没有，调用接口生成一个临时token；登录后后端会将token与uid关联，使得用户登录前的行为也可以被追溯
   * @return {Promise}
   */
  @mergingStep
  static _ensuringExistingToken(){
    return new Promise((resolve, reject)=>{
      // token已存在
      if(cookie.get('tk')){
        resolve();
        return;
      }

      ZZLogin._config.requester({
        url: 'https://xxx/getTempToken',
        success(res){
          let respCode = res.data.respCode;
          if(respCode == 0){
            if(!cookie.get('tk')){
              cookie.set('tk', res.data.respData.result);
            }
          }
        },
        complete(){
          // 成功失败都resolve，保证await后续请求流程可以正常进行
          resolve();
        }
      })
    });
  }

  static _execRequest(options, requestDetail, resolve, reject){
    //携带cookie信息
    if(!options.header)options.header = {};

    let cookieStr = cookie.getCookie();
    cookieStr = options.header.cookie ? cookieStr + options.header.cookie  : cookieStr;

    let opts = Object.assign({}, options);
    opts.header.cookie = cookieStr;

    //修改默认content-type为表单，因为转转后端接口大多是用表单格式
    opts.header['content-type'] = opts.header['content-type'] || "application/x-www-form-urlencoded";

    //将参数中的数组和对象转为json格式，避免被自动转为类似"[object Object]"的无语义字符串
    if (opts.header['content-type'].toLowerCase()==='application/x-www-form-urlencoded'){
      opts.data = opts.data || {};
      for (let name in opts.data) {
        if (typeof opts.data[name] === "object")
          opts.data[name] = JSON.stringify(opts.data[name]);
      }
    }

    let oriSuccessHandler = opts.success;
    let oriFailHandler = opts.fail;
    let oriCompleteHandler = opts.complete;
    
    let diySuccess = (res)=>{
      // 写cookie
      if(res.header && res.header['set-cookie']) {
        let setCookies = Array.isArray(res.header['set-cookie']) ? res.header['set-cookie'] : [res.header['set-cookie']];
        for (let setCookie of setCookies)
          cookie.setCookie(setCookie);
      }
      typeof oriSuccessHandler==="function" && oriSuccessHandler(res);
      typeof oriCompleteHandler==="function" && oriCompleteHandler(res);
      requestDetail ? resolve(res) : resolve(res.data);
    };

    let diyFail = (res)=>{
      if (ZZLogin._config.requestFailRecoverer) { //网络异常重试机制
        ZZLogin._config.requestFailRecoverer.call(this, {
          res,
          options: Object.assign({}, options, {success: null, fail: null, complete: null}),
          resolve(res){
            typeof oriSuccessHandler==="function" && oriSuccessHandler(res);
            typeof oriCompleteHandler==="function" && oriCompleteHandler(res);
            requestDetail ? resolve(res) : resolve(res.data);
          },
          reject(res){
            typeof oriFailHandler==="function" && oriFailHandler(res);
            typeof oriCompleteHandler==="function" && oriCompleteHandler(res);
            reject(res);
          }
        });
      } else {
        oriFailHandler && oriFailHandler(res);
        oriCompleteHandler && oriCompleteHandler(res);
        reject(res);
      }
    };

    ZZLogin._config.requester(Object.assign({}, opts, {success: diySuccess, fail: diyFail, complete: null}));
  }

  /**
   * http请求，封装了登录逻辑，保证登录后再发出请求
   * @param {Object} options 请求参数，格式同wx.request
   * @param {Object} options.loginOpts 登录选项，格式同login函数
   * @param {boolean} retryOnApiAuthFail 若登录态失效，是否自动重新登录并重新发送一次请求
   * @return {Promise} 返回结果，resolve时为接口返回内容, reject时为请求详情
   */
  static async requestWithLogin(options, retryOnApiAuthFail=true, tryAgainHandler=null){
    let loginRes = await ZZLogin.login.call(this, options.loginOpts);
    if (loginRes.code != 0)
      throw new Error('login failed, request not sent:'+options.url);

    // 登录态验证完成再执行成功回调
    let oriSuccess = options.success;
    options.success = null;

    let res = await ZZLogin.request.call(this, options, {requestDetail: true});
    let resp = res.data;

    //若登录信息失效，则清空并重试一次
    if(ZZLogin._config.apiAuthFail(resp, options)){
      ZZLogin._clearLoginInfo();
      if (retryOnApiAuthFail){
        if(typeof tryAgainHandler === 'function')return tryAgainHandler();
        return ZZLogin.requestWithLogin(options, false);
      }
    }

    typeof oriSuccess==="function" && oriSuccess(res);

    return resp;
  }

  /**
   * 获取微信用户信息（只读，不允许直接修改）
   * @return {Object} 微信用户信息，格式及内容同wx.getUserInfo接口返回值中userInfo字段
   */
  static get userInfo(){
    return ZZLogin._userInfo;
  }

  /**
   * 获取转转用户信息（只读，不允许直接修改）
   * @return {Object} 转转用户信息，含uid、ppu等
   */
  static get zzUserInfo(){
    return ZZLogin._zzUserInfo;
  }
}
export default ZZLogin;


/**
 * 类修饰器，确保调用API时已完成项目信息配置
 * @param target ZZLogin
 */
function requireConfig(target) {
  for (let prop of Object.getOwnPropertyNames(target)){
    if (['arguments', 'caller', 'callee', 'name', 'length'].includes(prop)) //内置属性，不予处理
      continue;
    if (typeof target[prop] !== "function") //非函数，不予处理
      continue;
    if (prop==="config" || prop==='install' || prop[0]==='_')  //配置函数、私有函数，不予处理
      continue;

    target[prop] = (function (oriFunc, funcName) {  //对外接口，增加配置检查步骤
      return function (...args) {
        if (!(target._config && target._config.source)){ //若未进行项目信息配置，则报错
          console.error('[ZZLogin] 请先执行ZZLogin.config配置小程序信息，后使用ZZLogin相关功能：',funcName);
          return;
        }
        return oriFunc.apply(this, args); //否则正常执行原函数
      }
    }(target[prop], prop));
  }
}