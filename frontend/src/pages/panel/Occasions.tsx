import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import {
  apiDelete,
  apiGet,
  apiPost,
  errorsFrom,
  type FieldErrors,
  type Page,
} from "../../api";
import { Field, FormAlert } from "../../components/Field";
import { Pager } from "../../components/Pager";
import {
  formatDate,
  formatDuration,
  formatRange,
  formatTimesShort,
  PAGE_SIZE,
  useDebounced,
  type PanelOccasion,
} from "./shared";

// Not over or cancelled yet: same rule as the server (an occasion with no end is over once it starts)
function isUpcoming(o: PanelOccasion) {
  return (
    !o.cancelled_at &&
    new Date(o.end_datetime ?? o.start_datetime).getTime() > Date.now()
  );
}

function hasEnded(o: PanelOccasion) {
  return new Date(o.end_datetime ?? o.start_datetime).getTime() <= Date.now();
}

type RowAction = "delete" | "finish" | "cancel" | "revert_cancel";

// What each two-step action asks, and the button that carries it out
const CONFIRM: Record<
  RowAction,
  { question: string; group: string; button: string; className: string }
> = {
  delete: {
    question: "Delete?",
    group: "Delete",
    button: "Delete",
    className: "btn-danger",
  },
  finish: {
    question: "Finish now?",
    group: "Finish",
    button: "Finish",
    className: "btn-confirm",
  },
  revert_cancel: {
    question: "Restore it?",
    group: "Revert cancel of",
    button: "Revert cancel",
    className: "btn-primary",
  },
  cancel: {
    question: "Cancel it?",
    group: "Cancel",
    button: "Cancel occasion",
    className: "btn-primary",
  },
};

export default function Occasions() {
  const [search, setSearch] = useState("");
  const query = useDebounced(search.trim());
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<PanelOccasion> | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  // Deleting, finishing and cancelling are two-step: the row asks for confirmation inline
  const [confirm, setConfirm] = useState<{
    id: number;
    action: RowAction;
  } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [creatingTest, setCreatingTest] = useState(false);
  const [testOccasion, setTestOccasion] = useState<PanelOccasion | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), search: query });
    return apiGet<Page<PanelOccasion>>(`/api/panel/occasions/?${params}`)
      .then(setData)
      .catch((err) => setErrors(errorsFrom(err)));
  }, [page, query]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(occasion: PanelOccasion) {
    setBusyId(occasion.id);
    setErrors({});
    try {
      await apiDelete(`/api/panel/occasions/${occasion.id}/`);
      setConfirm(null);
      // Step back a page if this deleted the last row on it
      if (data?.results.length === 1 && page > 1) setPage(page - 1);
      else load();
    } catch (err) {
      setErrors(errorsFrom(err));
    } finally {
      setBusyId(null);
    }
  }

  // finish: ends the occasion now; the worker then counts connections between its attendees.
  // cancel: calls it off; no connections are counted. Either way its attendees can join another occasion
  async function endEarly(
    occasion: PanelOccasion,
    action: "finish" | "cancel" | "revert_cancel",
  ) {
    setBusyId(occasion.id);
    setErrors({});
    try {
      await apiPost(`/api/panel/occasions/${occasion.id}/${action}/`);
      await load();
      setConfirm(null);
    } catch (err) {
      setErrors(errorsFrom(err));
    } finally {
      setBusyId(null);
    }
  }

  // Random time and 1-3 random attendees; the server creates test users if there are none
  async function createTest() {
    setCreatingTest(true);
    setErrors({});
    setTestOccasion(null);
    try {
      const occasion = await apiPost<PanelOccasion>(
        "/api/panel/occasions/test/",
      );
      // Refresh first, so the message never points at a row the table doesn't show yet
      await load();
      setTestOccasion(occasion);
    } catch (err) {
      setErrors(errorsFrom(err));
    } finally {
      setCreatingTest(false);
    }
  }

  return (
    <>
      <div className="panel-head">
        <h1>Occasions</h1>
        <div className="panel-head-actions">
          <button
            className="btn"
            type="button"
            onClick={createTest}
            disabled={creatingTest}
          >
            {creatingTest ? "Creating…" : "Create test occasion"}
          </button>
          <Link className="btn btn-primary" to="/admin/occasions/new">
            New occasion
          </Link>
        </div>
      </div>

      {testOccasion && (
        <p className="form-status" role="status">
          <span>
            Created{" "}
            <Link
              className="row-link"
              to={`/admin/occasions/${testOccasion.id}`}
            >
              {testOccasion.name}
            </Link>{" "}
            on{" "}
            {formatRange(
              testOccasion.start_datetime,
              testOccasion.end_datetime,
            )}{" "}
            with {testOccasion.attendees.map((a) => a.name).join(", ")}
          </span>
        </p>
      )}

      <div className="panel-toolbar">
        <Field
          id="occasion-search"
          label="Search by name"
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>

      <FormAlert messages={errors.non_field_errors} />

      {data && data.results.length === 0 && (
        <div className="empty">
          <p>
            {query ? `No occasions match “${query}”.` : "No occasions yet."}
          </p>
          {!query && (
            <Link className="btn btn-primary btn-sm" to="/admin/occasions/new">
              Create the first occasion
            </Link>
          )}
        </div>
      )}

      {data && data.results.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Occasion</th>
              <th scope="col">When</th>
              <th scope="col">Length</th>
              <th scope="col">Going</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.results.map((o) => (
              <tr key={o.id}>
                <td className="occasion-cell" data-label="Occasion">
                  <div className="occasion-main">
                    <Link
                      className="row-link"
                      to={`/admin/occasions/${o.id}`}
                      title={o.name}
                    >
                      {o.name}
                    </Link>
                    {/* Always rendered and one line high, so every row is the same height; the title lists what's cut off */}
                    <ul
                      className="row-meta"
                      aria-label="Status and tags"
                      title={[
                        o.cancelled_at && "Cancelled",
                        ...o.tags.map((t) => t.name),
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    >
                      {o.cancelled_at && (
                        <li className="tag tag-off">Cancelled</li>
                      )}
                      {o.tags.map((t) => (
                        <li className="tag tag-topic" key={t.id}>
                          {t.name}
                        </li>
                      ))}
                    </ul>
                  </div>
                </td>
                <td data-label="When">
                  <div
                    className="when"
                    title={formatRange(o.start_datetime, o.end_datetime)}
                  >
                    <time dateTime={o.start_datetime}>
                      {formatDate(o.start_datetime)}
                    </time>
                    <small>
                      {formatTimesShort(o.start_datetime, o.end_datetime)}
                    </small>
                  </div>
                </td>
                <td data-label="Length">
                  {o.duration_minutes === null
                    ? "Open"
                    : formatDuration(o.duration_minutes)}
                </td>
                <td data-label="Going">{o.attendees.length}</td>
                <td className="row-actions">
                  {confirm?.id === o.id ? (
                    <span
                      className="confirm"
                      role="group"
                      aria-label={`${CONFIRM[confirm.action].group} ${o.name}?`}
                    >
                      <span className="confirm-text">
                        {CONFIRM[confirm.action].question}
                      </span>
                      <button
                        className="btn btn-sm"
                        onClick={() => setConfirm(null)}
                        autoFocus
                      >
                        Keep
                      </button>
                      <button
                        className={`btn btn-sm ${CONFIRM[confirm.action].className}`}
                        disabled={busyId === o.id}
                        onClick={() =>
                          confirm.action === "delete"
                            ? remove(o)
                            : endEarly(o, confirm.action)
                        }
                      >
                        {CONFIRM[confirm.action].button}
                      </button>
                    </span>
                  ) : (
                    <>
                      {isUpcoming(o) && (
                        <button
                          className="btn btn-sm"
                          onClick={() =>
                            setConfirm({ id: o.id, action: "finish" })
                          }
                        >
                          Finish
                        </button>
                      )}
                      <Link
                        className="btn btn-sm"
                        to={`/admin/occasions/${o.id}`}
                      >
                        Edit
                      </Link>
                      {isUpcoming(o) && (
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() =>
                            setConfirm({ id: o.id, action: "cancel" })
                          }
                        >
                          Cancel
                        </button>
                      )}
                      {o.cancelled_at && !hasEnded(o) && (
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() =>
                            setConfirm({ id: o.id, action: "revert_cancel" })
                          }
                        >
                          Revert cancel
                        </button>
                      )}
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() =>
                          setConfirm({ id: o.id, action: "delete" })
                        }
                      >
                        Delete
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {data && (
        <Pager
          page={page}
          count={data.count}
          pageSize={PAGE_SIZE}
          onChange={setPage}
        />
      )}
    </>
  );
}
