import { Router, type IRouter } from "express";
import { requireAuth, requireAdmin } from "../middleware/auth";
import usersAdminRouter from "./admin/users";
import rolesAdminRouter from "./admin/roles";
import healthAdminRouter from "./admin/health";
import portfolioAdminRouter from "./admin/portfolio";
import projectVisibilityAdminRouter from "./admin/project-visibility";

const router: IRouter = Router();

// All admin routes require auth + admin role. Scoped to "/admin": this router is mounted without a
// prefix, so an unscoped router.use() here ran for every request that reached it - i.e. every
// router registered after it in routes/index.ts (qa-work, report-insights, sprint-goal,
// release-readiness...) answered 403 to members despite their role_permissions allowing it.
router.use("/admin", requireAuth, requireAdmin);

router.use("/admin", usersAdminRouter);
router.use("/admin", rolesAdminRouter);
router.use("/admin", healthAdminRouter);
router.use("/admin", portfolioAdminRouter);
router.use("/admin", projectVisibilityAdminRouter);

export default router;
