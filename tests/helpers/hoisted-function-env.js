// 经典 Env 外壳回归夹具：同一作用域内重复的 function 声明都在作用域入口
// 实例化，最后一个生效；Node 分支必须仍被平台折叠删除。
function Env(t) {
  class s {
    send() {
      return 1;
    }
  }
  return new class {
    constructor(t) {
      this.name = t;
    }
    getEnv() {
      return typeof module !== 'undefined' && module.exports ? 'Node.js' : 'Surge';
    }
    isNode() {
      return 'Node.js' === this.getEnv();
    }
    done() {
      switch (this.getEnv()) {
        case 'Surge':
        case 'Loon':
        default:
          $done({ name: this.name });
          break;
        case 'Node.js':
          require('fs').writeFileSync('x', 'y');
          break;
      }
    }
  }(t);
}
const $ = new Env('fixture');
main().then(() => $.done());
async function sign() {
  return $.done();
}
async function main() {
  await sign();
}
async function main() {
  await sign();
}
