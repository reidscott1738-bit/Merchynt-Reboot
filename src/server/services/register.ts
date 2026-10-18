/**
 * Importing this module registers every task-approval handler and
 * publication runner. Both the web server and the worker import it so an
 * approval behaves the same wherever it is processed.
 */
import "./posts";
import "./reviews";
import "./campaigns";
import "./seo";
import "./videos";
