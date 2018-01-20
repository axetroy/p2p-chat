const dgram = require("dgram");
const { EventEmitter } = require("events");
const inquirer = require("inquirer");
const readline = require("readline");
const chalk = require("chalk");
const moment = require("moment");

const PORT = process.env.PORT || 1099;

const port = parseInt(process.argv[2]); // router port

const host = process.argv[3]; // router host

let name = process.env.NAME;

function isMessage(msg) {
  try {
    JSON.parse(msg);
    return true;
  } catch (err) {
    return false;
  }
}

class Server extends EventEmitter {
  constructor() {
    super();
    this.logined = false; // 是否已连接到p2p网络
    this.networks = []; // p2p网络节点列表
    this.connection = null;
    const udp = (this.udp = dgram.createSocket("udp4", (message, ipAddress) => {
      message = message.toString();
      if (!isMessage(message)) return;
      const data = JSON.parse(message);
      const { name, action, payload } = data;
      switch (action) {
        case "newNode":
          this.onNewNode(payload);
          break;
        case "login":
          this.onLogin(name, payload, ipAddress);
          break;
        case "logout":
          break;
        case "logined":
          this.onLogined(name, payload, ipAddress);
          break;
        case "requestConnect":
          this.onRequestConnect(name, payload, ipAddress);
          break;
        case "connect":
          this.onConnect(name, payload, ipAddress);
          break;
        case "connected":
          this.onConnected(name, payload, ipAddress);
          break;
        case "message":
          this.onMessage(name, payload, ipAddress);
          break;
        default:
          console.log(
            `Invalid action type '${data.action}' from ${ipAddress.address}:${
              ipAddress.port
            }`
          );
      }
    }));
    udp.on("error", function(err) {
      console.error(err);
    });
    udp.on("close", function() {
      console.log("connection close.");
    });

    // 在程序退出之前，退出p2p网络
    process.on("exit", () => {
      if (this.logined) {
        // 广播网络
        this.networks.forEach(n => {
          this.dispatch(
            {
              name,
              action: "logout"
            },
            n.port,
            n.host
          );
        });
      }
    });
  }
  waitForConnection() {
    return new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        if (this.connection) {
          clearInterval(timer);
          resolve(this.connection);
        }
      }, 100);
    });
  }
  /**
   * 监听端口
   * @param port
   * @param cb
   * @returns {any}
   */
  listen(port, cb) {
    return this.udp.bind(port, cb);
  }

  onNewNode(ipAddress) {
    const node = this.networks.find(network => {
      return (
        network &&
        network.address === ipAddress.address &&
        network.port === ipAddress.port
      );
    });
    // 如果节点未存在，则加入
    if (!node) {
      this.networks.push({
        name,
        ...ipAddress
      });
    }
  }

  /**
   * 当有人登陆当前节点时
   * @param name 连接者的名字
   * @param data 空对象
   * @param ipAddress 连接者的ip信息
   */
  onLogin(name, data, ipAddress) {
    // 广播其他节点，有新节点加入
    this.networks.forEach(network => {
      this.dispatch(
        {
          name,
          action: "newNode",
          payload: {
            name,
            ...ipAddress
          }
        },
        network.port,
        network.address
      );
    });

    this.onNewNode({
      name,
      ...ipAddress
    });

    // 告诉登录者，加入网络成功, 并同步节点
    this.dispatch(
      {
        name,
        action: "logined",
        payload: this.networks
      },
      ipAddress.port,
      ipAddress.address
    );
  }

  /**
   * 当前节点登陆P2P网络之后的回调函数， 主要是获取当前存在的节点
   * @param name
   * @param data
   * @param ipAddress
   */
  onLogined(name, data, ipAddress) {
    let network;
    while ((network = data.shift())) {
      if (!this.networks.find(n => n.name === network.name)) {
        this.networks.push(network);
      }
    }
  }

  /**
   * 有人请求连接到当前节点
   * @param from 是谁请求的
   * @param data 请求体
   * @param ipAddress
   */
  onRequestConnect(from, data, ipAddress) {
    // 如果当前还没有于它建立连接
    if (this.connection !== from) {
      this.dispatch(
        {
          name,
          action: "requestConnect"
        },
        ipAddress.port,
        ipAddress.address
      );
      this.connection = {
        name: from,
        ...ipAddress
      };
    }
  }

  /**
   * 当节点有人连接进来时
   * @param name
   * @param data
   * @param ipAddress
   */
  onConnect(name, data, ipAddress) {
    // 如果不知道发送给谁
    if (!data.name) {
      return;
    }

    const node = this.networks.find(v => v.name === data.name);

    if (!node) {
      console.error(`Invalid address ${data.name}`);
    }

    // 通知主动连接方，连接成功
    this.dispatch(
      {
        action: "connected",
        payload: {
          name,
          ...node
        }
      },
      ipAddress.port,
      ipAddress.address
    );

    // 通知被动连接方，连接成功
    this.dispatch(
      {
        action: "connected",
        payload: {
          name,
          ...ipAddress
        }
      },
      node.port,
      node.address
    );
  }

  /**
   * 当节点连接到P2P网络成功时触发
   * @param name
   * @param data
   * @param ipAddress
   */
  onConnected(name, data, ipAddress) {
    console.log(`connect with ${chalk.green(data.address + ":" + data.port)}`);
    this.connection = data;
  }

  /**
   * 当节点收到消息时
   * @param name
   * @param data
   * @param ipAddress
   */
  onMessage(name, data, ipAddress) {
    console.log(
      `${moment().format("YYYY-MM-DD HH:mm:ss")} ${chalk.yellow(
        name
      )}: ${chalk.green(data)}`
    );
  }

  /**
   * 发送数据
   * @param data
   * @param port
   * @param host
   */
  dispatch(data, port, host) {
    return new Promise((resolve, reject) => {
      this.udp.send(
        Buffer.from(
          JSON.stringify({
            ...data,
            ...{ timestamp: parseInt(new Date().getTime() / 1000) }
          })
        ),
        port,
        host,
        (err, data) => {
          err ? reject(err) : resolve(data);
        }
      );
    });
  }
}

async function main() {
  if (!name) {
    const anwsers = await inquirer.prompt([
      {
        name: "name",
        type: "input",
        message: "What's your name?"
      }
    ]);

    name = anwsers.name;
  }

  const app = new Server();

  app.listen(PORT, function(err) {
    if (err) {
      console.error(err);
    } else {
      console.log("Listen on port", PORT);
    }
  });

  // 如果指定了端口，那么就作为客户端连接
  if (port) {
    await app.dispatch(
      {
        name,
        action: "login"
      },
      port,
      host
    );

    // 询问要和谁说话
    const result = await inquirer.prompt([
      {
        name: "wait",
        type: "confirm",
        message: "Do you want to wait for connected?"
      }
    ]);

    // 如果确定要等待连接的话
    if (!result.wait) {
      // 询问要和谁说话
      const anwsers = await inquirer.prompt([
        {
          name: "name",
          type: "input",
          message: "Which bitch do you want to talk to?"
        }
      ]);

      const to = anwsers.name;

      const network = app.networks.find(net => net && net.name === to);

      // 如果没有发现节点
      if (!network) {
        await app.dispatch(
          {
            name,
            action: "connect",
            payload: { name: to } // I wanna talk to this guy
          },
          port,
          host
        );
      } else {
        await app.dispatch(
          {
            name,
            action: "requestConnect"
          },
          network.port,
          network.address
        );
        app.connection = network;
      }

      await app.waitForConnection();

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      console.log(`Now, type the press Enter to chat.`);

      rl.on("SIGCONT", function() {
        app.udp.close();
      });

      rl.on("SIGINT", function() {
        app.udp.close();
      });

      rl.on("SIGTSTP", function() {
        app.udp.close();
      });

      rl.on("line", input => {
        app.dispatch(
          {
            name,
            action: "message",
            payload: input
          },
          app.connection.port,
          app.connection.address
        );
      });
    } else {
      await app.waitForConnection();

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      console.log(`Now, type the press Enter to chat.`);

      rl.on("SIGCONT", function() {
        app.udp.close();
      });

      rl.on("SIGINT", function() {
        app.udp.close();
      });

      rl.on("SIGTSTP", function() {
        app.udp.close();
      });

      rl.on("line", input => {
        app.dispatch(
          {
            name,
            action: "message",
            payload: input
          },
          app.connection.port,
          app.connection.address
        );
      });
    }
  }
}

main().catch(console.error);
