/*
 *
 * 处理js文件
 * 
 */
const t = require('@babel/types');
const path = require('path');
const parse = require('@babel/parser').parse;
const generate = require('@babel/generator').default;
const traverse = require('@babel/traverse').default;
const template = require('@babel/template').default;
const JavascriptParser = require('./js/JavascriptParser');
const componentConverter = require('./js/componentConverter');

const {
	toCamel2
} = require('../utils/utils.js');

/**
 * 将ast属性数组组合为ast对象
 * @param {*} pathAry 
 */
function arrayToObject(pathAry) {
	return t.objectExpression(pathAry);
}

/**
 * 子页面/组件的模板
 */
const componentTemplate =
	`
export default {
  data() {
    return DATA
  },
  components: {},
  props:PROPS,
  methods: METHODS,
  computed: COMPUTED,
  watch:WATCH,
}
`;

/**
 * App页面的模板
 */
const componentTemplateApp =
	`
export default {
  data() {
    return DATA
  },
  methods: METHODS
}
`;

/**
 * 生成"let = right;"表达式
 * @param {*} left 
 * @param {*} right 
 */
function buildAssignment(left, right) {
	return t.assignmentExpression("=", left, right);
}

/**
 * 生成"this.left = right;"表达式
 * @param {*} left 
 * @param {*} right 
 */
function buildAssignmentWidthThis(left, right) {
	return t.assignmentExpression("=", t.memberExpression(t.thisExpression(), left), right);
}

/**
 * 生成"that.left = right;"  //后面有需求再考虑其他关键字
 * @param {*} left 
 * @param {*} right 
 */
function buildAssignmentWidthThat(left, right, name) {
	return t.assignmentExpression("=", t.memberExpression(t.identifier(name), left), right);
}

/**
 * 处理this.setData -- 已弃用
 * @param {*} path 
 * @param {*} isThis 区分前缀是this，还是that
 */
function handleSetData(path, isThis) {
	let parent = path.parent;
	let nodeArr = [];
	if (parent.arguments) {
		parent.arguments.forEach(function (obj) {
			if (obj.properties) {
				obj.properties.forEach(function (item) {
					let left = item.key;
					//有可能key是字符串形式的
					if (t.isStringLiteral(left)) left = t.identifier(left.value);
					//
					let node = null;
					if (isThis) {
						node = t.expressionStatement(buildAssignmentWidthThis(left, item.value));
					} else {
						let object = path.get('object');
						node = t.expressionStatement(buildAssignmentWidthThat(left, item.value, object.node.name));
					}

					nodeArr.push(node);
				});
			}
		});
		if (nodeArr.length > 0) {
			//将this.setData({})进行替换
			//!!!!!!!!这里找父级使用递归查找，有可能path的上一级会是CallExpression!!!!!
			parent = path.findParent((parent) => parent.isExpressionStatement())
			if (parent) {
				parent.replaceWithMultiple(nodeArr);
			} else {
				console.log(`异常-->代码为：${generate(path.node).code}`);
			}
		}
	}
}

/**
 * 获取setData()的AST
 * 暂未想到其他好的方式来实现将setData插入到methods里。
 */
function getSetDataFun() {
	const code = `
	var setData = {
	setData:function(obj){  
		let that = this;  
		let keys = [];  
		let val,data;  
		Object.keys(obj).forEach(function(key){  
				keys = key.split('.');  
				val = obj[key];  
				data = that.$data;  
				keys.forEach(function(key2,index){  
					if(index+1 == keys.length){  
						that.$set(data,key2,val);  
					}else{  
						if(!data[key2]){  
							that.$set(data,key2,{});  
						}  
					}  
					data = data[key2];  
				})  
			});  
		} 
	}
	`;
	const ast = parse(code, {
		sourceType: 'module'
	});

	let result = null;
	traverse(ast, {
		ObjectProperty(path) {
			result = path.node;
		}
	});

	return result;
}

/**
 * 组件模板处理
 * @param {*} ast 
 * @param {*} vistors 
 * @param {*} isApp 是否为app.js文件
 * @param {*} usingComponents  使用的自定义组件列表
 */
const componentTemplateBuilder = function (ast, vistors, isApp, usingComponents) {
	let buildRequire = null;

	//插入setData()
	const node = getSetDataFun();
	vistors.methods.handle(node);
	//
	if (isApp) {
		//是app.js文件,要单独处理
		buildRequire = template(componentTemplateApp);
		//app.js目前看到有data属性的，其余的还未看到。
		ast = buildRequire({
			DATA: arrayToObject(vistors.data.getData()),
			METHODS: arrayToObject(vistors.methods.getData())
		});
	} else {
		//非app.js文件
		buildRequire = template(componentTemplate);

		ast = buildRequire({
			PROPS: arrayToObject(vistors.props.getData()),
			DATA: arrayToObject(vistors.data.getData()),
			METHODS: arrayToObject(vistors.methods.getData()),
			COMPUTED: arrayToObject(vistors.computed.getData()),
			WATCH: arrayToObject(vistors.watch.getData()),
		});
	}




	//久久不能遍历，搜遍google，template也没有回调，后面想着源码中应该会有蛛丝马迹，果然，在templateVisitor里找到了看到这么一个属性noScope，有点嫌疑
	//noScope: 从babel-template.js中发现这么一个属性，因为直接转出来的ast进行遍历时会报错，找了官方文档，没有这个属性的介绍信息。。。
	//Error: You must pass a scope and parentPath unless traversing a Program/File. Instead of that you tried to traverse a ExportDefaultDeclaration node without passing scope and parentPath.
	//babel-template直接转出来的ast只是完整ast的一部分
	traverse(ast, {
		noScope: true,
		enter(path) {
			// console.log(path);
			// console.log(path);
		},

		ObjectMethod(path) {
			// console.log("--------", path.node.key.name);
			if (path.node.key.name === 'data') {
				var liftCycleArr = vistors.lifeCycle.getData();
				for (let key in liftCycleArr) {
					// console.log(liftCycleArr[key]);
					path.insertAfter(liftCycleArr[key]);
				}
				//停止，不往后遍历了
				path.skip();

				if (isApp) {
					var methodsArr = vistors.methods.getData();
					for (let key in methodsArr) {
						let obj = methodsArr[key];
						if (!t.isIdentifier(obj.key, { name: "setData" })) {
							// console.log(liftCycleArr[key]);
							path.insertAfter(obj);
						}
					}
				}
			}
		},
		ObjectProperty(path) {
			if (path.node.key.name === 'components') {
				//import firstcompoent from '../firstcompoent/firstcompoent'
				//"firstcompoent": "../firstcompoent/firstcompoent"
				//
				// export default {
				// 	components: {
				// 	  ComponentA,
				// 	  ComponentC
				// 	},
				// }
				for (const key in usingComponents) {
					//中划线转驼峰
					let componentName = toCamel2(key);

					//这里两个小优化空间
					//1.是否有其他操作这个数组方式
					//2.属性名与变量名相同是否可以合并为一个？ (解决，第三个参数：shorthand：true 即可)
					path.node.value.properties.push(t.objectProperty(
						t.identifier(componentName),
						t.identifier(componentName),
						false,
						true
					));
				}
			}
		},
		MemberExpression(path) {
			//解决this.triggerEvent()的问题
			let object = path.get('object');
			let property = path.get('property');

			if (t.isIdentifier(property.node, { name: "triggerEvent" })) {
				let obj = t.memberExpression(object, t.identifier("$emit"));
				path.replaceWith(obj);
			}


			//解决this.setData的问题
			//20190719 
			//因为存在含有操作setData的三元表达式，如：
			//"block" == this.data.listmode ? this.setData({
			// 		listmode: ""
			// }) : this.setData({
			//		 listmode: "block"
			// })
			//和 this使用其他变量代替的情况，所以
			//回归初次的解决方案，使用一个setData()函数来替代。
			//
			// let object = path.get('object');
			// let property = path.get('property');
			// //
			// let parent = path.parent;

			// if (t.isThisExpression(object)) {
			// 	if (t.isIdentifier(property.node, { name: "setData" })) {
			// 		//如果是this.setData()时
			// 		handleSetData(path, true);
			// 	} else if (t.isIdentifier(property.node, { name: "data" })) {
			// 		//将this.data替换为this
			// 		path.replaceWith(t.thisExpression());
			// 	}
			// } else if (t.isIdentifier(property.node, { name: "setData" })) {
			// 	if (t.isIdentifier(object.node, { name: "that" })) {
			// 		//如果是that.setData()时
			// 		handleSetData(path);
			// 	}
			// }
			//
			//uni-app 支持getApp() 这里不作转换
			// if (t.isIdentifier(object.node, { name: "app" })) {
			// 	if (t.isIdentifier(property.node, { name: "globalData" })) {
			// 		//app.globalData.xxx的情况 
			// 		object.replaceWith(t.thisExpression());
			// 	} else {
			// 		//app.fun()的情况 这种不管
			// 	}
			// } else if (t.isCallExpression(object.node) && t.isIdentifier(path.get('object.callee').node, { name: "getApp" })) {
			// 	//getApp().globalData.userInfo => this.globalData.userInfo
			// 	object.replaceWith(t.thisExpression());
			// }
		},
	});
	return ast;
}

/**
 * js 处理入口方法
 * @param {*} fileData          要处理的文件内容 
 * @param {*} isApp             是否为入口app.js文件
 * @param {*} usingComponents   使用的自定义组件列表
 * @param {*} miniprogramRoot   小程序目录
 * @param {*} file_js           当前处理的文件路径
 */
async function jsHandle(fileData, isApp, usingComponents, miniprogramRoot, file_js) {
	//先反转义
	let javascriptContent = fileData;

	//初始化一个解析器
	let javascriptParser = new JavascriptParser();

	//去除无用代码
	javascriptContent = javascriptParser.beforeParse(javascriptContent);

	//解析成AST
	let javascriptAst = await javascriptParser.parse(javascriptContent);

	//进行代码转换
	let {
		convertedJavascript,
		vistors,
		declareStr
	} = componentConverter(javascriptAst, miniprogramRoot, file_js);

	//引入自定义组件
	//import firstcompoent from '../firstcompoent/firstcompoent'
	for (const key in usingComponents) {
		let filePath = usingComponents[key];
		//filePath = filePath.replace(/^\//g, "./"); //相对路径处理

		//先转绝对路径，再转相对路径
		filePath = path.join(miniprogramRoot, filePath);
		filePath = path.relative(miniprogramRoot, filePath);

		//中划线转驼峰
		let componentName = toCamel2(key);
		//
		let node = t.importDeclaration([t.importDefaultSpecifier(t.identifier(componentName))], t.stringLiteral(filePath));
		declareStr += `${generate(node).code}\r\n`;
	}

	//相对路径里\\替换为/
	declareStr = declareStr.split("\\\\").join("/");

	//放到预先定义好的模板中
	convertedJavascript = componentTemplateBuilder(javascriptAst, vistors, isApp, usingComponents);


	// console.log(`${generate(convertedJavascript).code}`);


	//生成文本并写入到文件
	let codeText = `<script>\r\n${declareStr}\r\n${generate(convertedJavascript).code}\r\n</script>\r\n`;


	// console.log(codeText);
	return codeText;
}
module.exports = jsHandle;