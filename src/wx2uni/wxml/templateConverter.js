const path = require('path');
const {
	isURL
} = require('../../utils/utils.js');


//html标签替换规则，可以添加更多
const tagConverterConfig = {
	// 'image': 'img'
}
//属性替换规则，也可以加入更多
const attrConverterConfigVue = {
	'wx:for': {
		key: 'v-for',
		value: (str) => {
			return str.replace(/{{(.*)}}/, '(item,key) in $1')
		}
	},
	'wx:if': {
		key: 'v-if',
		value: (str) => {
			return str.replace(/{{(.*)}}/, '$1')
		}
	},
	'@tap': {
		key: '@click'
	},
}

const attrConverterConfigUni = {
	// 'wx:for': {
	// 	key: 'v-for',
	// 	value: (str) => {
	// 		return str.replace(/{{ ?(.*?) ?}}/, '(item, index) in $1" :key="index')
	// 	}
	// },
	'wx:if': {
		key: 'v-if',
		value: (str) => {
			return str.replace(/{{ ?(.*?) ?}}/, '$1').replace(/\"/g, "'")
		}
	},
	// 'wx:key': {
	// 	key: ':key',
	// 	value: (str) => {
	// 		return str.replace(/{{ ?(.*?) ?}}/, '$1').replace(/\"/g, "'")
	// 	}
	// },
	'wx:else': {
		key: 'v-else',
		value: (str) => {
			return str.replace(/{{ ?(.*?) ?}}/, '$1').replace(/\"/g, "'")
		}
	},
	'wx:elif': {
		key: 'v-else-if',
		value: (str) => {
			return str.replace(/{{ ?(.*?) ?}}/, '$1').replace(/\"/g, "'")
		}
	},
	'scrollX': {
		key: 'scroll-x'
	},
	'scrollY': {
		key: 'scroll-y'
	},
	'bindtap': {
		key: '@tap'
	},
	'bindinput': {
		key: '@input'
	},
	'bindgetuserinfo': {
		key: '@getuserinfo'
	},
	'catch:tap': {
		key: '@tap.native.stop'
	},
	// 'style': {
	// 	key: 'style', //这里需要根据绑定情况来判断是否增加:
	// 	value: (str) => {
	// 		// var tmpStr = str.replace(/}}rpx/g, " + 'rpx'");
	// 		// tmpStr = tmpStr.replace(/[({{)(}})]/g, '');
	// 		// return '{' + tmpStr + '}';

	// 		let reg = /"(.*?){{(.*?)}}(.*?)"/g;

	// 		// style="background-image: url({{avatarUrl}})"
	// 	}
	// }
}

/**
 * wmxml转换
 * // style="color: {{step === index + 1 ? 'red': 'black'}}; font-size:{{abc}}">
 * // <view style="width : {{item.dayExpressmanEarnings / maxIncome * 460 + 250}}rpx;"></view>
 * 
 * @param {*} ast 抽象语法树
 * @param {Boolean} isChildren 是否正在遍历子项目
 */
const templateConverter = function (ast, isChildren, file_wxml) {
	var reg_tag = /{{.*?}}/; //注：连续test时，这里不能加/g，因为会被记录上次index位置
	for (let i = 0; i < ast.length; i++) {
		let node = ast[i];
		//检测到是html节点
		if (node.type === 'tag') {
			//template标签上面的属性不作转换 // <template is="head" data="{{title: 'addPhoneContact'}}"/>
			// if (node.name == "template") continue;
			//进行标签替换  
			if (tagConverterConfig[node.name]) {
				node.name = tagConverterConfig[node.name];
			}
			//进行属性替换
			let attrs = {};
			for (let k in node.attribs) {
				let target = attrConverterConfigUni[k];
				if (target) {
					//单独判断style的绑定情况
					var key = target['key'];
					var value = node.attribs[k];
					//将双引号转换单引号
					value = value.replace(/\"/g, "'");

					// if (k == 'style') {
					// 	var hasBind = value.indexOf("{{") > -1;
					// 	key = hasBind ? ':style' : this.key;
					// } else 
					if (k == 'url') {
						var hasBind = value.indexOf("{{") > -1;
						key = hasBind ? ':url' : this.key;
					}
					attrs[key] = target['value'] ?
						target['value'](node.attribs[k]) :
						node.attribs[k];
				} else if (k == 'class') {
					//class单独处理
					var value = node.attribs[k];
					//将双引号转换单引号
					value = value.replace(/\"/g, "'");
					var hasBind = reg_tag.test(value);
					if (hasBind) {
						var reg = /(.*?) +{{(.*?)}}/g;
						let tempR;
						while (tempR = reg.exec(value)) {
							attrs['class'] = tempR[1];
							attrs[':class'] = tempR[2];
						}
					} else {
						attrs['class'] = node.attribs[k];
					}
				} else if (k == 'wx:for' || k == 'wx:for-items') {
					//wx:for单独处理
					//wx:key="*item" -----不知道vue支持不
					/**
					 * wx:for规则:
					 * 
					 * 情况一：
					 * <block wx:for="{{uploadImgsArr}}" wx:key="">{{item.savethumbname}}</block>
					 * 解析规则：
					 * 1.没有key时，设为index
					 * 2.没有wx:for-item时，默认设置为item
					 * 
					 * 情况二：
					 * <block wx:for="{{hotGoodsList}}" wx:key="" wx:for-item="item">
           			 * 		<block wx:for="{{item.markIcon}}" wx:key="" wx:for-item="subItem">
          			 *   		<text>{{subItem}}</text>
          			 *  	</block>
         			 * </block>
					 * 解析规则：同上
					 * 
					 * 
					 * 情况三：
					 * <block wx:for-items="{{countyList}}" wx:key="{{index}}">
					 *     <view data-index="{{index}}" data-code="{{item.cityCode}}">
					 *     		<view>{{item.areaName}}</view>
					 *     </view>
					 * </block>
					 * 解析规则：同上
					 * 
					 * 情况四：
					 * <view wx:for="{{list}}" wx:key="{{index}}">
					 *		<view wx:for-items="{{item.child}}" wx:key="{{index}}" data-id="{{item.id}}" wx:for-item="item">
					 *		</view>
					 * </view>
					 * 解析规则：
					 * 1.wx:for同上
					 * 2.遍历到wx:for-items这一层时，如果有wx:for-item属性，且parent含有wx:for时，将wx:for-item的值设置为parent的wx:for遍历出的子元素的别称
					 */

					//这里预先设置wx:for是最前面的一个属性，这样会第一个被遍历到
					let wx_key = node.attribs["wx:key"];
					let wx_for = node.attribs["wx:for"];
					let wx_forItem = node.attribs["wx:for-item"];
					let wx_forItems = node.attribs["wx:for-items"];
					//wx:for与wx:for-items互斥
					var value = wx_for ? wx_for : wx_forItems;

					//替换{{}}
					if (wx_key)
					{
						wx_key = wx_key.trim();
						wx_key = wx_key.replace(/{{ ?(.*?) ?}}/, '$1').replace(/\"/g, "'");
					} 
					//处理wx:key
					if (node.parent && node.parent.attribs["v-for"]) {
						//如果父元素有v-for，那么当前元素的index应该需要变化一下，防止冲突
						//这里有两种情况：
						//1.这里先赌一把，应该极少有两层以上的循环吧~
						//2.如果在小程序里设置的key两层都为index时，这里再判断一下
						wx_key = (wx_key && wx_key != "index") ? wx_key : "index2";
					} else {
						//设置默认key
						wx_key = wx_key ? wx_key : "index";
					}

					//设置for-item默认值
					wx_forItem = wx_forItem ? wx_forItem : "item";

					//将双引号转换单引号
					value = value.replace(/\"/g, "'");
					value = value.replace(/{{ ?(.*?) ?}}/, '(' + wx_forItem + ', ' + wx_key + ') in $1');
					if (value == node.attribs[k]) {
						//奇葩!!! 小程序写起来太自由了，相比js有过之而无不及，{{}}可加可不加……我能说什么？
						//这里处理无{{}}的情况
						value = '(' + wx_forItem + ', ' + wx_key + ') in ' + value;
					}

					attrs['v-for'] = value;
					attrs[':key'] = wx_key;
					if (node.attribs.hasOwnProperty("wx:key")) delete node.attribs["wx:key"];
					if (node.attribs.hasOwnProperty("wx:for-item")) delete node.attribs["wx:for-item"];
					if (node.attribs.hasOwnProperty("wx:for-items")) delete node.attribs["wx:for-items"];
				} else {
					// "../list/list?type={{ item.key }}&title={{ item.title }}"
					// "'../list/list?type=' + item.key ' + '&title=' + item.title"

					//其他属性
					//处理下面这种嵌套关系的样式或绑定的属性
					//style="background-image: url({{avatarUrl}});color:{{abc}};font-size:12px;"
					var value = node.attribs[k];
					var hasBind = reg_tag.test(value);
					if (hasBind) {
						var reg1 = /(?!^){{ ?/g; //中间的{{
						var reg2 = / ?}}(?!$)/g; //中间的}}
						var reg3 = /^{{ ?/; //起始的{{
						var reg4 = / ?}}$/; //文末的}}
						value = value.replace(reg1, "' + ").replace(reg2, " + '");

						//单独处理前后是否有{{}}的情况
						if (reg3.test(value)) {
							//有起始的{{的情况
							value = value.replace(reg3, "");
						} else {
							value = "'" + value;
						}
						if (reg4.test(value)) {
							//有结束的}}的情况
							value = value.replace(reg4, "");
						} else {
							value = value + "'";
						}
						//将双引号转换单引号
						value = value.replace(/\"/g, "'");

						attrs[":" + k] = value;
					} else {
						attrs[k] = node.attribs[k];
					}
				}
			}

			//处理template image标签下面的src路径
			//e:\zpWork\Project_self\miniprogram-to-uniapp\test\test2\index\images\ic_detail_blue.png
			//e:\zpWork\Project_self\miniprogram-to-uniapp\test\test2\static\images\ic_detail_blue.png
			if (node.name == "image") {
				let reg = /.(jpg|jpeg|gif|svg|png)$/g;
				//image标签，处理src路径
				var src = attrs.src;
				//忽略网络素材地址，不然会转换出错
				if (!isURL(src) && reg.test(src)) {
					//当前处理文件所在目录
					let wxmlFolder = path.dirname(file_wxml);
					//src资源完整路径
					let filePath = path.resolve(wxmlFolder, src);
					//src资源文件相对于src所在目录的相对路径
					let relativePath = path.relative(global.miniprogramRoot, filePath);
					//处理images或image目录在pages下面的情况 
					relativePath = relativePath.replace(/^pages\\/, "");

					//资源文件路径
					let newImagePath = path.join(global.miniprogramRoot, "static/" + relativePath);
					newImagePath = path.relative(wxmlFolder, newImagePath);
					//修复路径
					newImagePath = newImagePath.split("\\").join("/");
					attrs.src = newImagePath;
				}
			}

			node.attribs = attrs;
		} else if (node.type === 'text') {
			// var hasBind = reg_tag.test(node.data);
			// if (hasBind) {
			// 	var tmpStr = node.data.replace(/[({{)(}})]/g, '');
			// 	node.data = '{{' + tmpStr + '}}';
			// }
		} else if (node.type === 'Literal') {
			//处理wxml里导入wxml的情况
			//暂未想好怎么转换
			// node.value = node.value.replace(/.wxml/g, ".css");

		} else if (node.type === 'img') {
			//正则匹配路径
			// let reg = /^\.\/.*?\.(jpg|jpeg|gif|svg|png)/;
			// let key = path.node.key;
			// let valueTxt = path.node.value.value;

			// //判断是否含有当前目录的文件路径
			// //微信的页面是多页面的，即单独启动某个文件，而vue是单页面的，转换后导致原有资源引用报错。
			// if (reg.test(valueTxt)) {
			// 	//js文件所在目录
			// 	let fileDir = nodePath.dirname(file_js);
			// 	let filePath;
			// 	if (/^\//.test(valueTxt)) {
			// 		//如果是以/开头的，表示根目录
			// 		filePath = nodePath.join(miniprogramRoot, valueTxt);
			// 	} else {
			// 		filePath = nodePath.join(fileDir, valueTxt);
			// 	}
			// 	filePath = nodePath.relative(miniprogramRoot, filePath);
			// 	filePath = filePath.split("\\").join("/");
			// 	//手动组装
			// 	let node = t.objectProperty(key, t.stringLiteral(filePath));
			// 	vistors.data.handle(node);
			// } else {
			// 	vistors.data.handle(path.node);
			// }
		}
		//因为是树状结构，所以需要进行递归
		if (node.children) {
			templateConverter(node.children, true, file_wxml);
		}
	}
	return ast;
}

module.exports = templateConverter;