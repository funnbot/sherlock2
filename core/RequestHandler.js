const path = require("path");
const express = require("express");
const bodyparser = require("body-parser");
const session = require("express-session");

const keychain = require("../keychain.json");
const Logger = require("./Util/Logger");
const Database = require("./Database");
const EndpointManager = require("./EndpointManager");

class RequestHandler {
    constructor(app) {
        this.express = express;
        this.router = this.express.Router(); // eslint-disable-line new-cap
        this.server = app;

        this.server.use(bodyparser.json());
        this.server.use(bodyparser.urlencoded({ extended: true }));
        this.server.use(session({ resave: 1, saveUninitialized: 0, secret: keychain.session, maxAge: 168 * 60 * 60 * 1000 }));

        this.server.set("view engine", "ejs");
        this.server.set("views", path.join(__dirname, ".."));
        this.server.use(this.express.static("public"));
        this.server.use(this.router);

        this.handler = new EndpointManager(this.server);
        this.handler.loadModules("api/*/*.js");
        this.handler.loadModules("panel/*.js");

        this.routes = this.handler.routes;
        this.handleRoutes();
    }

    handleRoutes() {
        // Endpoints
        for (const item of this.routes.values()) {
            this.router.all(item.route, this.handle.bind(this));
        }

        // Root
        this.router.all("/", (req, res) => res.redirect("/panel"));

        // 404
        this.router.all("*", this.handle.bind(this));
    }

    async handle(req, res) {
        const ip = req.headers["x-real-ip"] || req.ip.replace("::ffff:", "");
        const url = req.url.split("?")[0];
        const token = req.headers.authorization;
        const method = req.method;
        const data = method === "GET" ? req.query : req.body;
        const route = this.routes.get(req.route.path);
        const masked = route && route.mask ? {} : data;
        const user = token
            ? await Database.checkToken(token)
            : req.session && req.session.token
                ? await Database.checkToken(req.session.token)
                : { ok: false };

        if (!route) {
            res.status(404).send({ ok: false, error: "Missing/Unknown Endpoint" });
            return this.log(false, ip, url, masked, user, method, "MISSING_ENDPOINT", 404);
        }

        if (route.method !== "all" && route.method !== method) {
            res.status(405).send({ ok: false, error: "Method Not Allowed" });
            return this.log(false, ip, url, masked, user, method, "BAD_METHOD", 405);
        }

        if (route.admin && req.session && !req.session.admin) {
            res.status(403).send({ ok: false, error: "Forbidden" });
            return this.log(false, ip, url, masked, user, method, "NO_ADMIN", 403);
        }

        if (route.token) {
            if (!token) {
                res.status(401).send({ ok: false, error: "Authentication Required" });
                return this.log(false, ip, url, masked, user, method, "NO_TOKEN", 401);
            }

            if (!user.ok) {
                res.status(401).send({ ok: false, error: user.error });
                return this.log(false, ip, url, masked, user, method, "BAD_TOKEN", 401);
            }
        }

        this.log(true, ip, url, masked, user, method);
        res.set("X-Powered-By", "Sherlock");
        res.set("Access-Control-Allow-Origin", "*");
        return route.run(req, res, data);
    }

    log(ok, ip, url, data, auth, method, error, code) {
        const style = ok ? "success" : "error";
        const indicator = ok ? "✓" : "✘";
        const user = auth && auth.ok ? auth.username : ip;
        const body = Object.keys(data).length > 0 ? data : null;
        return Logger[style]("Router", `${method} ${user} ${url} ${body ? `${JSON.stringify(body)} ` : ""}${indicator} ${error ? error : ""}${code ? ` ${code}` : ""}`);
    }
}

module.exports = RequestHandler;
