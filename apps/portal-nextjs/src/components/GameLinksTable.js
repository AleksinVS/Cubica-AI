"use client";

/**
 * Purchased-game links table.
 *
 * The component keeps launch behavior generic: it reads purchase/link ids from
 * row data, tries the portal API first, and falls back to static demo data when
 * the backend is unavailable during local review.
 */

import { useState } from "react";
import styled from "styled-components";
import { CiShare2 } from "react-icons/ci";
import { FaUsers } from "react-icons/fa";
import { copyLaunchLink, listActiveSessions } from "@/lib/portalApi";

const COPY_SUCCESS_MESSAGE = "Ссылка скопирована в буфер обмена";

const TableScroll = styled.div`
  width: 100%;
  overflow-x: auto;
`;

const Table = styled.table`
  width: 100%;
  border-collapse: separate;
  border-spacing: 0 10px;
  table-layout: fixed;

  @media (max-width: 768px) {
    display: block;
    min-width: 0;
    padding: 10px;
  }
`;

const Th = styled.th`
  background-color: rgb(var(--background));
  color: rgb(var(--foreground));
  padding: 10px;
  border-bottom: 1px solid rgba(var(--theme-yellow), 0.8);
  text-align: left;
  font-weight: 400;

  &:nth-child(2) {
    width: 34%;
  }

  &:nth-child(4),
  &:nth-child(5) {
    text-align: right;
  }

  @media (max-width: 768px) {
    display: none;
  }
`;

const Td = styled.td`
  padding: 10px;
  vertical-align: middle;
  overflow-wrap: anywhere;

  &:nth-child(4),
  &:nth-child(5) {
    text-align: right;
  }

  @media (max-width: 768px) {
    display: flex;
    width: 100%;
    flex-direction: column;
    gap: 4px;
    text-align: left;
    padding: 6px 0;

    &:nth-child(4),
    &:nth-child(5) {
      text-align: left;
    }
  }
`;

const DateContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;

  @media (max-width: 768px) {
    justify-content: flex-start;
    flex-wrap: wrap;
  }
`;

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;

  @media (max-width: 768px) {
    justify-content: flex-start;
    flex-wrap: wrap;
  }
`;

const HoverRow = styled.tr`
  transition: all 0.3s ease-in-out;
  border: 1px solid rgba(var(--background), 1);
  border-radius: 5px;

  &:hover,
  &:focus-within {
    box-shadow: 0 0 0 1px rgba(var(--theme-yellow), 1);
    border-radius: 5px;
    outline: none;

    & svg {
      color: rgb(var(--theme-yellow));
    }
  }

  @media (max-width: 768px) {
    display: block;
    margin-bottom: 10px;
    border: 1px solid rgba(var(--theme-yellow), 0.8);
    padding: 15px;
  }
`;

const StyledLink = styled.a`
  display: inline-block;
  max-width: 100%;
  text-decoration: none;
  color: rgb(var(--foreground));
  overflow-wrap: anywhere;

  &:hover {
    color: rgb(var(--theme-yellow));
  }
`;

const PendingLinkText = styled.span`
  display: inline-block;
  color: rgba(var(--foreground), 0.75);
`;

const IconButton = styled.button`
  background: transparent;
  border: 1px solid rgba(var(--theme-grey), 0.45);
  border-radius: 6px;
  color: rgb(var(--foreground));
  cursor: pointer;
  min-width: 36px;
  min-height: 36px;
  padding: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;

  &:hover {
    border-color: rgb(var(--theme-yellow));
    color: rgb(var(--theme-yellow));
  }
`;

const SessionsButton = styled(IconButton)`
  padding: 8px 10px;
  white-space: nowrap;
`;

const Notice = styled.p`
  margin: 0 10px 10px;
  color: rgb(var(--theme-yellow));
`;

const ModalOverlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.6);
`;

const Modal = styled.div`
  width: min(640px, 100%);
  max-height: min(80vh, 720px);
  overflow: auto;
  border: 1px solid rgba(var(--theme-yellow), 0.45);
  border-radius: 8px;
  background: rgb(var(--background));
  color: rgb(var(--foreground));
  padding: 20px;
`;

const ModalHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 16px;
`;

const ModalTitle = styled.h2`
  font-size: 1.1rem;
  font-weight: 500;
`;

const SessionList = styled.ul`
  display: flex;
  flex-direction: column;
  gap: 10px;
  list-style: none;
`;

const SessionItem = styled.li`
  border: 1px solid rgba(var(--theme-grey), 0.35);
  border-radius: 6px;
  padding: 12px;
`;

const SessionMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  color: rgba(var(--foreground), 0.75);
  font-size: 0.9rem;
`;

const SessionActions = styled.div`
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
`;

const AdminLink = styled.a`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: 7px 10px;
  border: 1px solid rgba(var(--theme-grey), 0.45);
  border-radius: 6px;
  color: rgb(var(--foreground));
  text-decoration: none;

  &:hover {
    border-color: rgb(var(--theme-yellow));
    color: rgb(var(--theme-yellow));
  }
`;

function getLaunchIds(game, link) {
  return {
    purchaseId: link.purchaseDocumentId || link.purchaseId || game.purchaseDocumentId,
    linkId: link.linkDocumentId || link.linkId || link.documentId,
  };
}

function isMultiplayerLink(game, link) {
  const markers = [
    game.gameType,
    game.mode,
    link.gameType,
    link.mode,
    link.type,
  ].filter(Boolean);

  return markers.some((marker) =>
    ["multiplayer", "multi_player", "team", "командная"].includes(
      String(marker).toLowerCase()
    )
  );
}

function formatSessionPeriod(session) {
  const start = session.startDate || session.startedAt || session.createdAt;
  const end = session.endDate || session.expiresAt || session.finishedAt;

  if (start && end) {
    return `${start} - ${end}`;
  }

  return start || end || "Без срока";
}

async function copyText(text) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

const GameLinksTable = ({ games }) => {
  const [notice, setNotice] = useState("");
  const [sessionsModal, setSessionsModal] = useState(null);

  if (!games || games.length === 0) {
    return <p>У вас пока что нет купленных игр</p>;
  }

  const handleShare = async (game, link) => {
    const { purchaseId, linkId } = getLaunchIds(game, link);
    let urlToCopy = link.url;

    if (purchaseId || linkId) {
      try {
        const launchLink = await copyLaunchLink({ purchaseId, linkId });
        urlToCopy = launchLink.url || urlToCopy;
      } catch {
        // Static review must keep working before the portal backend is ready.
        urlToCopy = link.url;
      }
    }

    await copyText(urlToCopy);
    setNotice(COPY_SUCCESS_MESSAGE);
  };

  const handleSessions = async (game, link) => {
    const { purchaseId, linkId } = getLaunchIds(game, link);
    let sessions = link.sessions || [];

    if (purchaseId || linkId) {
      try {
        sessions = await listActiveSessions({ purchaseId, linkId });
      } catch {
        // Local sessions are demo data for visual review without backend.
        sessions = link.sessions || [];
      }
    }

    setSessionsModal({
      title: game.gameName,
      linkType: link.type,
      sessions,
    });
  };

  return (
    <>
      {notice ? <Notice role="status">{notice}</Notice> : null}
      <TableScroll>
        <Table>
          <thead>
            <tr>
              <Th>Все игры</Th>
              <Th>Ссылки</Th>
              <Th>Все типы</Th>
              <Th>Все даты</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {games.map((game) =>
              game.links.map((link) => (
                <HoverRow key={link.id} tabIndex="0">
                  <Td>{game.gameName}</Td>
                  <Td>
                    {link.url && link.url !== "#" ? (
                      <StyledLink href={link.url} target="_blank">
                        {link.url}
                      </StyledLink>
                    ) : (
                      <PendingLinkText>
                        Ссылка создается при копировании
                      </PendingLinkText>
                    )}
                  </Td>
                  <Td>{link.type}</Td>
                  <Td>
                    <DateContainer>
                      {link.startDate && link.endDate ? (
                        <span>{link.startDate} - {link.endDate}</span>
                      ) : (
                        <span>{link.date}</span>
                      )}
                    </DateContainer>
                  </Td>
                  <Td>
                    <Actions>
                      <IconButton
                        type="button"
                        aria-label="Скопировать ссылку"
                        title="Скопировать ссылку"
                        onClick={() => handleShare(game, link)}
                      >
                        <CiShare2 size={20} aria-hidden="true" />
                      </IconButton>
                      {isMultiplayerLink(game, link) ? (
                        <SessionsButton
                          type="button"
                          onClick={() => handleSessions(game, link)}
                        >
                          <FaUsers size={16} aria-hidden="true" />
                          Сессии
                        </SessionsButton>
                      ) : null}
                    </Actions>
                  </Td>
                </HoverRow>
              ))
            )}
          </tbody>
        </Table>
      </TableScroll>

      {sessionsModal ? (
        <ModalOverlay role="dialog" aria-modal="true" aria-label="Сессии">
          <Modal>
            <ModalHeader>
              <div>
                <ModalTitle>Активные сессии</ModalTitle>
                <p>
                  {sessionsModal.title} · {sessionsModal.linkType}
                </p>
              </div>
              <IconButton type="button" onClick={() => setSessionsModal(null)}>
                Закрыть
              </IconButton>
            </ModalHeader>

            {sessionsModal.sessions.length > 0 ? (
              <SessionList>
                {sessionsModal.sessions.map((session, index) => (
                  <SessionItem key={session.id || session.sessionId || index}>
                    <strong>
                      {session.title ||
                        session.name ||
                        session.sessionId ||
                        `Сессия ${index + 1}`}
                    </strong>
                    <SessionMeta>
                      <span>Статус: {session.status || "active"}</span>
                      <span>Срок: {formatSessionPeriod(session)}</span>
                      <span>
                        Запусков: {session.launchCount ?? session.launch_count ?? 0}
                      </span>
                    </SessionMeta>
                    {session.adminUrl || session.admin_url ? (
                      <SessionActions>
                        <AdminLink href={session.adminUrl || session.admin_url}>
                          Admin
                        </AdminLink>
                      </SessionActions>
                    ) : null}
                  </SessionItem>
                ))}
              </SessionList>
            ) : (
              <p>Активных сессий пока нет.</p>
            )}
          </Modal>
        </ModalOverlay>
      ) : null}
    </>
  );
};

export default GameLinksTable;
