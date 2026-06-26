import { Router, type IRouter } from "express";
import { requireAuth, requireAdmin } from "../middleware/auth";
import usersAdminRouter from "./admin/users";
import rolesAdminRouter from "./admin/roles";
import healthAdminRouter from "./admin/health";
import portfolioAdminRouter from "./admin/portfolio";
import projectVisibilityAdminRouter from "./admin/project-visibility";

const router: IRouter = Router();

// All admin routes require auth + admin role
router.use(requireAuth, requireAdmin);

router.use("/admin", usersAdminRouter);
router.use("/admin", rolesAdminRouter);
router.use("/admin", healthAdminRouter);
router.use("/admin", portfolioAdminRouter);
router.use("/admin", projectVisibilityAdminRouter);

export default router;
