import { type FormEvent, useEffect, useState } from "react";
import type { User } from "./api/users";
import { UserSwitcher } from "./components/UserSwitcher";
import { AssignmentPage } from "./pages/AssignmentPage";
import { DashboardPage, type DashboardView } from "./pages/DashboardPage";
import { GroupPage } from "./pages/GroupPage";
import { GroupsPage } from "./pages/GroupsPage";
import { ReceiptsPage } from "./pages/ReceiptsPage";
import { SettlementPage } from "./pages/SettlementPage";
import { SplitBillPage } from "./pages/SplitBillPage";
import "./styles.css";
import "./split-session.css";
import { SplitSessionPage } from "./pages/SplitSessionPage";

import { SettlementHistoryPage } from "./pages/SettlementHistoryPage";

type Route =
  | { page: "history" }
  | { page: "split" }
  | { page: "receipt-flow" }
  | { page: "dashboard"; view: DashboardView }
  | { page: "groups" }
  | { page: "group"; groupId: number }
  | { page: "receipts" }
  | { page: "assign-items" }
  | { page: "settlement"; billId?: number }
  | { page: "assignment"; billId: number }
  | { page: "invalid-bill" };

function currentRoute(): Route {
  const hash = window.location.hash;
  if (hash === "#history") return { page: "history" };
  if (hash === "#receipt-flow") return { page: "receipt-flow" };
  if (hash === "#split") return { page: "split" };
  if (hash === "#dashboard") return { page: "dashboard", view: "Dashboard" };
  if (hash === "#dashboard/groups") return { page: "dashboard", view: "Groups" };
  if (hash === "#dashboard/expenses") return { page: "dashboard", view: "Expenses" };
  if (hash === "#assign-items") return { page: "assign-items" };
  if (hash === "#receipts") return { page: "receipts" };
  if (hash === "#settlement") return { page: "settlement" };
  const settlementMatch = hash.match(/^#settlement\/([1-9]\d*)$/);
  if (settlementMatch) {
    return { page: "settlement", billId: Number(settlementMatch[1]) };
  }
  if (hash === "#groups") return { page: "groups" };
  const groupMatch = hash.match(/^#groups\/([1-9]\d*)$/);
  if (groupMatch) return { page: "group", groupId: Number(groupMatch[1]) };
  const billMatch = hash.match(/^#bills\/([1-9]\d*)$/);
  const rawBillId = billMatch?.[1] ?? new URLSearchParams(window.location.search).get("bill");
  if (rawBillId !== null) {
    const billId = Number(rawBillId);
    return Number.isSafeInteger(billId) && billId > 0
      ? { page: "assignment", billId }
      : { page: "invalid-bill" };
  }
  return { page: "split" };
}

function AssignmentPicker() {
  const [billId, setBillId] = useState("");
  const [error, setError] = useState<string | null>(null);
  function openBill(event: FormEvent) {
    event.preventDefault();
    const id = Number(billId);
    if (!Number.isSafeInteger(id) || id <= 0) {
      setError("Enter a positive whole-number bill ID.");
      return;
    }
    window.location.hash = `bills/${id}`;
  }
  return (
    <section>
      <h1>Assign items</h1>
      <p>Enter the ID of an existing bill to assign its items to diners.</p>
      <form onSubmit={openBill}>
        <label htmlFor="assignment-bill-id">Bill ID</label>
        <input
          id="assignment-bill-id"
          inputMode="numeric"
          required
          value={billId}
          onChange={(event) => {
            setBillId(event.target.value);
            setError(null);
          }}
        />
        <button type="submit">Open bill</button>
      </form>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

function renderPage(route: Route) {
  if (route.page === "history") return <SettlementHistoryPage />;
  if (route.page === "split") return <SplitSessionPage />;
  if (route.page === "assign-items") return <AssignmentPicker />;
  if (route.page === "assignment") {
    return (
      <AssignmentPage
        billId={route.billId}
        onContinue={() => {
          window.location.hash = `settlement/${route.billId}`;
        }}
      />
    );
  }
  if (route.page === "invalid-bill") {
    return <p role="alert">Invalid bill ID. Open a bill using a positive integer ID.</p>;
  }
  if (route.page === "receipts") return <ReceiptsPage />;
  if (route.page === "receipt-flow") return <SplitBillPage />;
  if (route.page === "settlement") return <SettlementPage billId={route.billId} />;
  if (route.page === "group") return <GroupPage key={route.groupId} groupId={route.groupId} />;
  return <GroupsPage />;
}

export function App() {
  const [route, setRoute] = useState(currentRoute);
  const [users, setUsers] = useState<User[]>([]);
  function openDashboard(view: DashboardView) {
    window.location.hash = view === "Dashboard" ? "dashboard" : `dashboard/${view.toLowerCase()}`;
  }
  useEffect(() => {
    const onNavigation = () => setRoute(currentRoute());
    window.addEventListener("hashchange", onNavigation);
    window.addEventListener("popstate", onNavigation);
    return () => {
      window.removeEventListener("hashchange", onNavigation);
      window.removeEventListener("popstate", onNavigation);
    };
  }, []);
  if (route.page === "history") return <SettlementHistoryPage />;
  if (import.meta.env.VITE_LOCAL_MODE === "true" || route.page === "split") {
    return <SplitSessionPage />;
  }
  return (
    <>
      <div className="dashboard-theme split-session legacy-header">
        <header className="topbar">
          <a className="brand" href="#split" aria-label="SplitEase home">
            <span>Split</span>Ease
          </a>
          <nav aria-label="Main">
            <a className="nav-item" href="#history">
              Settlement history
            </a>
            <a className="nav-item" href="#split">
              SplitEase
            </a>
            <a
              className="nav-item"
              href="#dashboard"
              aria-current={route.page === "dashboard" ? "page" : undefined}
            >
              Dashboard
            </a>
            <a
              className="nav-item"
              href="#groups"
              aria-current={route.page === "groups" || route.page === "group" ? "page" : undefined}
            >
              Groups
            </a>
            <a
              className="nav-item"
              href="#receipts"
              aria-current={route.page === "receipts" ? "page" : undefined}
            >
              Receipts
            </a>
            <a
              className="nav-item"
              href="#assign-items"
              aria-current={
                route.page === "assign-items" || route.page === "assignment" ? "page" : undefined
              }
            >
              Assign items
            </a>
            <a
              className="nav-item"
              href="#settlement"
              aria-current={route.page === "settlement" ? "page" : undefined}
            >
              Settle bill
            </a>
          </nav>
          {(route.page === "dashboard" || route.page === "assignment") && (
            <UserSwitcher onUsersLoaded={setUsers} />
          )}
        </header>
      </div>
      {route.page === "dashboard" ? (
        <div className="dashboard-theme">
          <nav className="dashboard-tabs" aria-label="Dashboard preview">
            {(["Dashboard", "Groups", "Expenses"] as const).map((view) => (
              <button
                type="button"
                className={`nav-item ${route.view === view ? "active" : ""}`}
                key={view}
                onClick={() => openDashboard(view)}
              >
                {view}
              </button>
            ))}
          </nav>
          <DashboardPage users={users} view={route.view} onViewChange={openDashboard} />
        </div>
      ) : (
        <main className="legacy-content">{renderPage(route)}</main>
      )}
    </>
  );
}
