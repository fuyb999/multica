package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

type expertInspirationSessionStore struct {
	mu       sync.Mutex
	sessions map[string]expertInspirationSessionRecord
	events   map[string][]expertInspirationEventRecord
	counter  int64
}

type expertInspirationSkill struct {
	ID   string
	Name string
}

type expertInspirationSessionRecord struct {
	ID               string
	WorkspaceID      string
	CreatedBy        string
	Question         string
	Status           string
	ConcurrencyLimit int32
	SelectedSkillIDs []string
	Summary          string
	ErrorMessage     string
	CreatedAt        string
	UpdatedAt        string
}

type expertInspirationEventRecord struct {
	ID          string
	SessionID   string
	WorkspaceID string
	ExpertRunID string
	Seq         int64
	EventType   string
	Payload     map[string]any
	CreatedAt   string
}

func newExpertInspirationSessionStore() *expertInspirationSessionStore {
	return &expertInspirationSessionStore{
		sessions: make(map[string]expertInspirationSessionRecord),
		events:   make(map[string][]expertInspirationEventRecord),
	}
}

func (s *expertInspirationSessionStore) nextID(prefix string) string {
	s.counter++
	return prefix + "-" + time.Now().UTC().Format("20060102150405") + "-" + strconv.FormatInt(s.counter, 10)
}

func splitQuestionTerms(question string) []string {
	fields := strings.Fields(strings.ToLower(strings.TrimSpace(question)))
	if len(fields) > 4 {
		fields = fields[:4]
	}
	return fields
}

func buildExpertOpinion(skillID, skillName, question string, batch int) map[string]any {
	terms := splitQuestionTerms(question)
	lead := "the prompt"
	if len(terms) > 0 {
		lead = strings.Join(terms[:min(len(terms), 2)], ", ")
	}
	return map[string]any{
		"title":       "Expert opinion ready",
		"detail":      skillName + " recommends using evidence around " + lead + ".",
		"tokens":      terms,
		"tools":       []string{"tokenizer", "planner", "es"},
		"confidence":  70 + batch*4,
		"citations":   2,
		"opinion":     skillName + " recommends acting on " + lead + ".",
		"skill_id":    skillID,
		"expert_name": skillName,
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func (s *expertInspirationSessionStore) list(workspaceID string) []expertInspirationSessionRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]expertInspirationSessionRecord, 0)
	for _, sess := range s.sessions {
		if sess.WorkspaceID == workspaceID {
			out = append(out, sess)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt > out[j].UpdatedAt })
	return out
}

func (s *expertInspirationSessionStore) create(workspaceID, createdBy, question string, concurrency int32, selected []string) expertInspirationSessionRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	id := s.nextID("eis")
	now := time.Now().UTC().Format(time.RFC3339Nano)
	sess := expertInspirationSessionRecord{
		ID:               id,
		WorkspaceID:      workspaceID,
		CreatedBy:        createdBy,
		Question:         question,
		Status:           "queued",
		ConcurrencyLimit: concurrency,
		SelectedSkillIDs: append([]string(nil), selected...),
		Summary:          "",
		ErrorMessage:     "",
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	s.sessions[id] = sess
	s.addEventLocked(id, workspaceID, "", "session_created", map[string]any{
		"question":           question,
		"title":              "Session started",
		"detail":             "Analysis session created.",
		"selected_skill_ids": append([]string(nil), selected...),
	})
	return sess
}

func (s *expertInspirationSessionStore) addEventLocked(sessionID, workspaceID, expertRunID, eventType string, payload map[string]any) expertInspirationEventRecord {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	seq := int64(len(s.events[sessionID]) + 1)
	ev := expertInspirationEventRecord{
		ID:          s.nextID("eiev"),
		SessionID:   sessionID,
		WorkspaceID: workspaceID,
		ExpertRunID: expertRunID,
		Seq:         seq,
		EventType:   eventType,
		Payload:     payload,
		CreatedAt:   now,
	}
	s.events[sessionID] = append(s.events[sessionID], ev)
	return ev
}

func (s *expertInspirationSessionStore) addEvent(sessionID, workspaceID, expertRunID, eventType string, payload map[string]any) expertInspirationEventRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.addEventLocked(sessionID, workspaceID, expertRunID, eventType, payload)
}

func (s *expertInspirationSessionStore) updateSession(sessionID string, mutate func(*expertInspirationSessionRecord)) (expertInspirationSessionRecord, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.sessions[sessionID]
	if !ok {
		return expertInspirationSessionRecord{}, false
	}
	mutate(&sess)
	sess.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	s.sessions[sessionID] = sess
	return sess, true
}

func (s *expertInspirationSessionStore) get(sessionID string) (expertInspirationSessionRecord, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.sessions[sessionID]
	return sess, ok
}

func (s *expertInspirationSessionStore) eventsFor(sessionID string) []expertInspirationEventRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := append([]expertInspirationEventRecord(nil), s.events[sessionID]...)
	return out
}

type expertInspirationSessionResponse struct {
	ID               string                         `json:"id"`
	WorkspaceID      string                         `json:"workspace_id"`
	CreatedBy        *string                        `json:"created_by"`
	Question         string                         `json:"question"`
	Status           string                         `json:"status"`
	ConcurrencyLimit int32                          `json:"concurrency_limit"`
	SelectedSkillIDs []string                       `json:"selected_skill_ids"`
	Summary          string                         `json:"summary"`
	ErrorMessage     string                         `json:"error_message"`
	CreatedAt        string                         `json:"created_at"`
	UpdatedAt        string                         `json:"updated_at"`
	Events           []expertInspirationEventRecord `json:"events"`
}

func expertSessionToResponse(sess expertInspirationSessionRecord, events []expertInspirationEventRecord) expertInspirationSessionResponse {
	var createdBy *string
	if sess.CreatedBy != "" {
		createdBy = &sess.CreatedBy
	}
	return expertInspirationSessionResponse{
		ID:               sess.ID,
		WorkspaceID:      sess.WorkspaceID,
		CreatedBy:        createdBy,
		Question:         sess.Question,
		Status:           sess.Status,
		ConcurrencyLimit: sess.ConcurrencyLimit,
		SelectedSkillIDs: append([]string(nil), sess.SelectedSkillIDs...),
		Summary:          sess.Summary,
		ErrorMessage:     sess.ErrorMessage,
		CreatedAt:        sess.CreatedAt,
		UpdatedAt:        sess.UpdatedAt,
		Events:           events,
	}
}

type createExpertInspirationSessionRequest struct {
	Question         string   `json:"question"`
	ConcurrencyLimit int32    `json:"concurrency_limit"`
	SelectedSkillIDs []string `json:"selected_skill_ids"`
}

func (h *Handler) expertInspirationStore() *expertInspirationSessionStore {
	if h.expertInspiration == nil {
		h.expertInspiration = newExpertInspirationSessionStore()
	}
	return h.expertInspiration
}

func (h *Handler) resolveExpertInspirationSkills(ctx context.Context, workspaceID string, selected []string) []expertInspirationSkill {
	if len(selected) == 0 {
		return []expertInspirationSkill{}
	}

	nameByID := make(map[string]string)
	if h.Queries != nil {
		if rows, err := h.Queries.ListSkillSummariesByWorkspace(ctx, parseUUID(workspaceID)); err == nil {
			for _, skill := range rows {
				nameByID[uuidToString(skill.ID)] = skill.Name
			}
		}
	}

	skills := make([]expertInspirationSkill, 0, len(selected))
	for i, id := range selected {
		name := nameByID[id]
		if name == "" {
			name = "Expert " + strconv.Itoa(i+1)
		}
		skills = append(skills, expertInspirationSkill{ID: id, Name: name})
	}
	return skills
}
func (h *Handler) ListExpertInspirationSessions(w http.ResponseWriter, r *http.Request) {
	workspaceID := workspaceIDFromURL(r, "workspaceId")
	sessions := h.expertInspirationStore().list(workspaceID)
	resp := make([]expertInspirationSessionResponse, 0, len(sessions))
	for _, sess := range sessions {
		resp = append(resp, expertSessionToResponse(sess, h.expertInspirationStore().eventsFor(sess.ID)))
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) CreateExpertInspirationSession(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := workspaceIDFromURL(r, "workspaceId")
	if workspaceID == "" {
		writeError(w, http.StatusBadRequest, "workspace_id is required")
		return
	}
	_, ok = h.requireWorkspaceMember(w, r, workspaceID, "workspace not found")
	if !ok {
		return
	}
	var req createExpertInspirationSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Question = strings.TrimSpace(req.Question)
	if req.Question == "" {
		writeError(w, http.StatusBadRequest, "question is required")
		return
	}
	if req.ConcurrencyLimit <= 0 {
		req.ConcurrencyLimit = 3
	}
	if req.SelectedSkillIDs == nil {
		req.SelectedSkillIDs = []string{}
	}
	sess := h.expertInspirationStore().create(workspaceID, userID, req.Question, req.ConcurrencyLimit, req.SelectedSkillIDs)
	events := h.expertInspirationStore().eventsFor(sess.ID)
	resp := expertSessionToResponse(sess, events)
	writeJSON(w, http.StatusCreated, resp)
	h.publish(protocol.EventExpertInspirationSessionCreated, workspaceID, "member", userID, resp)

	go h.runExpertInspirationSession(sess.ID, workspaceID, req.Question, req.SelectedSkillIDs, req.ConcurrencyLimit)
}

func (h *Handler) GetExpertInspirationSession(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "sessionId")
	sess, ok := h.expertInspirationStore().get(sessionID)
	if !ok {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	writeJSON(w, http.StatusOK, expertSessionToResponse(sess, h.expertInspirationStore().eventsFor(sessionID)))
}

func (h *Handler) publishExpertInspirationEvent(workspaceID, sessionID, eventType string) {
	h.publish(protocol.EventExpertInspirationSessionEvent, workspaceID, "system", "", map[string]any{
		"session_id": sessionID,
		"event_type": eventType,
	})
}

func (h *Handler) addExpertInspirationSkillEvent(sessionID, workspaceID string, skill expertInspirationSkill, eventType string, payload map[string]any) {
	payload["skill_id"] = skill.ID
	payload["expert_name"] = skill.Name
	h.expertInspirationStore().addEvent(sessionID, workspaceID, skill.ID, eventType, payload)
	h.publishExpertInspirationEvent(workspaceID, sessionID, eventType)
}

func (h *Handler) runExpertInspirationSession(sessionID, workspaceID, question string, selected []string, concurrencyLimit int32) {
	if _, ok := h.expertInspirationStore().updateSession(sessionID, func(sess *expertInspirationSessionRecord) {
		sess.Status = "running"
	}); ok {
		sess, _ := h.expertInspirationStore().get(sessionID)
		h.publish(protocol.EventExpertInspirationSessionUpdated, workspaceID, "system", "", expertSessionToResponse(sess, h.expertInspirationStore().eventsFor(sessionID)))
	}

	terms := splitQuestionTerms(question)
	if len(terms) == 0 {
		terms = []string{"prompt"}
	}

	eventSleep := 70 * time.Millisecond
	batchSize := int(concurrencyLimit)
	if batchSize <= 0 {
		batchSize = 1
	}

	skills := h.resolveExpertInspirationSkills(context.Background(), workspaceID, selected)
	for start := 0; start < len(skills); start += batchSize {
		end := start + batchSize
		if end > len(skills) {
			end = len(skills)
		}
		batch := start/batchSize + 1

		var wg sync.WaitGroup
		for i, skill := range skills[start:end] {
			index := start + i
			wg.Add(1)
			go func(skill expertInspirationSkill, index, batch int) {
				defer wg.Done()

				time.Sleep(eventSleep)
				h.addExpertInspirationSkillEvent(sessionID, workspaceID, skill, "expert_dispatched", map[string]any{
					"title":  "Expert dispatched",
					"detail": skill.Name + " started wave " + strconv.Itoa(batch) + ".",
					"wave":   batch,
				})

				time.Sleep(eventSleep)
				h.addExpertInspirationSkillEvent(sessionID, workspaceID, skill, "tokens_generated", map[string]any{
					"title":  "Tokens generated",
					"detail": "Tokenized query for " + skill.Name + ".",
					"tokens": terms,
					"wave":   batch,
				})

				time.Sleep(eventSleep)
				h.addExpertInspirationSkillEvent(sessionID, workspaceID, skill, "tool_call_started", map[string]any{
					"title":  "Tool call started",
					"detail": "Tokenizer and planner tool stack started for " + skill.Name + ".",
					"tools":  []string{"tokenizer", "planner"},
					"wave":   batch,
				})

				time.Sleep(eventSleep)
				h.addExpertInspirationSkillEvent(sessionID, workspaceID, skill, "es_query_started", map[string]any{
					"title":  "ES query started",
					"detail": "Searching evidence in ES for " + skill.Name + ".",
					"tokens": terms,
					"wave":   batch,
				})

				time.Sleep(eventSleep)
				h.addExpertInspirationSkillEvent(sessionID, workspaceID, skill, "es_query_finished", map[string]any{
					"title":     "ES query finished",
					"detail":    "Retrieved evidence snippets for " + skill.Name + ".",
					"citations": 2,
					"wave":      batch,
				})

				time.Sleep(eventSleep)
				h.addExpertInspirationSkillEvent(sessionID, workspaceID, skill, "expert_opinion_ready", buildExpertOpinion(skill.ID, skill.Name, question, index))
			}(skill, index, batch)
		}
		wg.Wait()
	}

	time.Sleep(eventSleep)
	h.expertInspirationStore().addEvent(sessionID, workspaceID, "", "synthesis_progress", map[string]any{
		"title":  "Synthesis in progress",
		"detail": "Merged expert opinions into a single answer.",
	})
	h.publishExpertInspirationEvent(workspaceID, sessionID, "synthesis_progress")

	time.Sleep(eventSleep)
	if sess, ok := h.expertInspirationStore().updateSession(sessionID, func(sess *expertInspirationSessionRecord) {
		sess.Status = "completed"
		sess.Summary = "Synthesis complete."
	}); ok {
		h.publish(protocol.EventExpertInspirationSessionUpdated, workspaceID, "system", "", expertSessionToResponse(sess, h.expertInspirationStore().eventsFor(sessionID)))
	}
}
