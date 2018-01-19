const dgram = require("dgram");
const { EventEmitter } = require("events");
const inquirer = require("inquirer");
const readline = require("readline");
const chalk = require("chalk");
const moment = require("moment");

const user = {};

const PORT = process.env.PORT || 1099;

const port = parseInt(process.argv[2]); // router port

const host = process.argv[3]; // router host

let name = process.env.NAME;

function isMessage(msg) {
  try {
    const data = JSON.parse(msg);
    return true;
  } catch (err) {
    return false;
  }
}

class Server extends EventEmitter {
  constructor() {
    super();
    const udp = (this.udp = dgram.createSocket(
      "udp4",
      this.message.bind(this)
    ));
    udp.on("error", function(err) {
      console.error(err);
    });
    udp.on("close", function() {
      console.log("connection close.");
    });
    this.connection = null;
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

  /**
   * 处理接受的消息
   * @param data
   * @param ipAddress
   */
  message(data, ipAddress) {
    const msg = data.toString();
    if (isMessage(msg)) {
      const data = JSON.parse(msg);
      const payload = data.payload;
      user[data.name] = {
        ...ipAddress
      };

      switch (data.action) {
        // 登录
        case "login":
          user[data.name] = {
            ...ipAddress,
            name: data.name
          };
          // 告诉登录者，将入网络成功
          this.dispatch(
            {
              name,
              action: "logined",
              timestamp: parseInt(new Date().getTime() / 1000)
            },
            ipAddress.port,
            ipAddress.address
          );
          break;
        case "logined":
          break;
        // 与某某某创建连接
        case "connect":
          // 如果不知道发送给谁
          if (!payload.name) {
            return;
          }

          const target = user[payload.name];

          // 如果用户不存在
          if (!target) {
            return;
          }

          // 通知主动连接方，连接成功
          this.dispatch(
            {
              action: "connected",
              payload: {
                name: payload.name,
                ...target
              },
              timestamp: parseInt(new Date().getTime() / 1000)
            },
            ipAddress.port,
            ipAddress.host
          );

          // 通知被动连接方，连接成功
          this.dispatch(
            {
              action: "connected",
              payload: {
                name: data.name,
                ...ipAddress
              },
              timestamp: parseInt(new Date().getTime() / 1000)
            },
            target.port,
            target.host
          );

          break;
        // 接受到消息
        case "connected":
          console.log(
            `connect with ${chalk.green(payload.address + ":" + payload.port)}`
          );
          this.connection = payload;
          break;
        case "message":
          console.log(
            `${moment(new Date(data.timestamp * 1000)).format(
              "YYYY-MM-DD HH:mm:ss"
            )} ${chalk.yellow(data.name)}: ${chalk.green(payload)}`
          );
          break;
      }
    }
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
        Buffer.from(JSON.stringify(data)),
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
    }
  });

  // 如果指定了端口，那么就作为客户端连接
  if (port) {
    await app.dispatch(
      {
        name,
        action: "login",
        timestamp: parseInt(new Date().getTime() / 1000)
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

      await app.dispatch(
        {
          name,
          action: "connect",
          payload: { name: to }, // I wanna talk to this guy
          timestamp: parseInt(new Date().getTime() / 1000)
        },
        port,
        host
      );

      console.log(`Connecting...`);

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
            payload: input,
            timestamp: parseInt(new Date().getTime() / 1000)
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
            payload: input,
            timestamp: parseInt(new Date().getTime() / 1000)
          },
          app.connection.port,
          app.connection.address
        );
      });
    }
  }
}

main().catch(console.error);
