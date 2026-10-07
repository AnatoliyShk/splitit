import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import {
  apiDelete,
  apiGet,
  apiPost,
  useFieldErrors,
} from "../../api";
import { Field, FormAlert } from "../../components/Field";
import { Pager } from "../../components/Pager";
import { listQueryString, queryKeys } from "../../queryClient";
import type { PanelOccasion } from "../../types/api/admin";
import type { Page } from "../../types/api/pagination";
import {
  formatDate,
  formatDuration,
  formatRange,
  formatTimesShort,
  PAGE_SIZE,
  useDebounced,
} from "./shared";

// Not over or cancelled yet: same rule as the server (an occasion with no end is over once it starts)
function isUpcoming(occasion: PanelOccasion) {
  return (
    !occasion.cancelled_at &&
    new Date(occasion.end_datetime ?? occasion.start_datetime).getTime() >
      Date.now()
  );
}

function hasEnded(occasion: PanelOccasion) {
  return (
    new Date(occasion.end_datetime ?? occasion.start_datetime).getTime() <=
    Date.now()
  );
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
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const searchQuery = useDebounced(search.trim());
  const [page, setPage] = useState(1);
  const listParams = { page, search: searchQuery };

  const occasionsQuery = useQuery({
    queryKey: queryKeys.panel.occasions(listParams),
    queryFn: () =>
      apiGet<Page<PanelOccasion>>(
        `/api/admin/occasions/?${listQueryString(listParams)}`,
      ),
    // Keep the current page on screen while the next one loads
    placeholderData: keepPreviousData,
  });
  const occasionsPage = occasionsQuery.data;
  const refreshOccasions = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.panel.occasions() });

  // Deleting, finishing and cancelling are two-step: the row asks for confirmation inline
  const [confirmAction, setConfirmAction] = useState<{
    occasionId: number;
    action: RowAction;
  } | null>(null);

  // delete: removes the occasion.
  // finish: ends the occasion now; the worker then counts connections between its attendees.
  // cancel: calls it off; no connections are counted. Either way its attendees can join another occasion
  const rowMutation = useMutation({
    mutationFn: ({
      occasion,
      action,
    }: {
      occasion: PanelOccasion;
      action: RowAction;
    }) =>
      action === "delete"
        ? apiDelete(`/api/admin/occasions/${occasion.id}/`)
        : apiPost(`/api/admin/occasions/${occasion.id}/${action}/`),
    onMutate: () => {
      testMutation.reset();
    },
    onSuccess: async (_, { action }) => {
      // Step back a page if this deleted the last row on it
      if (
        action === "delete" &&
        occasionsPage?.results.length === 1 &&
        page > 1
      ) {
        setPage(page - 1);
      } else {
        await refreshOccasions();
      }
      setConfirmAction(null);
    },
  });
  const busyOccasionId = rowMutation.isPending
    ? rowMutation.variables.occasion.id
    : null;

  // Random time and 1-3 random attendees; the server creates test users if there are none
  const testMutation = useMutation({
    mutationFn: () => apiPost<PanelOccasion>("/api/admin/occasions/test/"),
    onMutate: () => {
      rowMutation.reset();
    },
    // Refresh first, so the message never points at a row the table doesn't show yet
    onSuccess: () => refreshOccasions(),
  });
  // Shown only once the table has it (see onSuccess)
  const testOccasion = testMutation.isSuccess ? testMutation.data : null;

  const errors = useFieldErrors(
    rowMutation.error,
    testMutation.error,
    occasionsQuery.error,
  );

  return (
    <>
      <div className="panel-head">
        <h1>Occasions</h1>
        <div className="panel-head-actions">
          <button
            className="btn"
            type="button"
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
          >
            {testMutation.isPending ? "Creating…" : "Create test occasion"}
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
            with{" "}
            {testOccasion.attendees.map((attendee) => attendee.name).join(", ")}
          </span>
        </p>
      )}

      <div className="panel-toolbar">
        <Field
          id="occasion-search"
          label="Search by name"
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </div>

      <FormAlert messages={errors.non_field_errors} />

      {occasionsPage && occasionsPage.results.length === 0 && (
        <div className="empty">
          <p>
            {searchQuery
              ? `No occasions match “${searchQuery}”.`
              : "No occasions yet."}
          </p>
          {!searchQuery && (
            <Link className="btn btn-primary btn-sm" to="/admin/occasions/new">
              Create the first occasion
            </Link>
          )}
        </div>
      )}

      {occasionsPage && occasionsPage.results.length > 0 && (
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
            {occasionsPage.results.map((occasion) => (
              <tr key={occasion.id}>
                <td className="occasion-cell" data-label="Occasion">
                  <div className="occasion-main">
                    <Link
                      className="row-link"
                      to={`/admin/occasions/${occasion.id}`}
                      title={occasion.name}
                    >
                      {occasion.name}
                    </Link>
                    {/* Always rendered and one line high, so every row is the same height; the title lists what's cut off */}
                    <ul
                      className="row-meta"
                      aria-label="Status and tags"
                      title={[
                        occasion.cancelled_at && "Cancelled",
                        ...occasion.tags.map((tag) => tag.name),
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    >
                      {occasion.cancelled_at && (
                        <li className="tag tag-off">Cancelled</li>
                      )}
                      {occasion.tags.map((tag) => (
                        <li className="tag tag-topic" key={tag.id}>
                          {tag.name}
                        </li>
                      ))}
                    </ul>
                  </div>
                </td>
                <td data-label="When">
                  <div
                    className="when"
                    title={formatRange(occasion.start_datetime, occasion.end_datetime)}
                  >
                    <time dateTime={occasion.start_datetime}>
                      {formatDate(occasion.start_datetime)}
                    </time>
                    <small>
                      {formatTimesShort(occasion.start_datetime, occasion.end_datetime)}
                    </small>
                  </div>
                </td>
                <td data-label="Length">
                  {occasion.duration_minutes === null
                    ? "Open"
                    : formatDuration(occasion.duration_minutes)}
                </td>
                <td data-label="Going">{occasion.attendees.length}</td>
                <td className="row-actions">
                  {confirmAction?.occasionId === occasion.id ? (
                    <span
                      className="confirm"
                      role="group"
                      aria-label={`${CONFIRM[confirmAction.action].group} ${occasion.name}?`}
                    >
                      <span className="confirm-text">
                        {CONFIRM[confirmAction.action].question}
                      </span>
                      <button
                        className="btn btn-sm"
                        onClick={() => setConfirmAction(null)}
                        autoFocus
                      >
                        Keep
                      </button>
                      <button
                        className={`btn btn-sm ${CONFIRM[confirmAction.action].className}`}
                        disabled={busyOccasionId === occasion.id}
                        onClick={() =>
                          rowMutation.mutate({
                            occasion,
                            action: confirmAction.action,
                          })
                        }
                      >
                        {CONFIRM[confirmAction.action].button}
                      </button>
                    </span>
                  ) : (
                    <>
                      {isUpcoming(occasion) && (
                        <button
                          className="btn btn-sm"
                          onClick={() =>
                            setConfirmAction({ occasionId: occasion.id, action: "finish" })
                          }
                        >
                          Finish
                        </button>
                      )}
                      <Link
                        className="btn btn-sm"
                        to={`/admin/occasions/${occasion.id}`}
                      >
                        Edit
                      </Link>
                      {isUpcoming(occasion) && (
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() =>
                            setConfirmAction({ occasionId: occasion.id, action: "cancel" })
                          }
                        >
                          Cancel
                        </button>
                      )}
                      {occasion.cancelled_at && !hasEnded(occasion) && (
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() =>
                            setConfirmAction({ occasionId: occasion.id, action: "revert_cancel" })
                          }
                        >
                          Revert cancel
                        </button>
                      )}
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() =>
                          setConfirmAction({ occasionId: occasion.id, action: "delete" })
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

      {occasionsPage && (
        <Pager
          page={page}
          count={occasionsPage.count}
          pageSize={PAGE_SIZE}
          onChange={setPage}
        />
      )}
    </>
  );
}
