import type { ErrorCode } from '@kwiz/domain'

/**
 * Keys are `<surface>.<section>.<key>` (conventions §6.1), flat within a section and never
 * deeper than three levels, so any key is greppable.
 *
 * `admin`, `control`, `screen` and `player` arrive with the surfaces that need them — an
 * empty section written now is a stub.
 *
 * **No hardcoded user-facing string anywhere, including scaffolding.** The rule only holds
 * if it holds from the first page.
 */

/**
 * conventions §6.1 — **`errors.<CODE>` mirrors the `ErrorCode` catalogue exactly**, and the
 * annotation is what makes "exactly" true: a code added to conventions §4 without copy here
 * is a compile error, not a raw `SCREAMING_SNAKE` string in front of a room.
 *
 * A server `message` is English, for logs, and a client must never show it (protocol §7.3).
 * This is where user-facing copy lives, which is also why several of these say less than the
 * server does: *"That code doesn't match a game"* is more use to a player than the id that
 * failed to resolve.
 */
const errors: Record<ErrorCode, string> = {
  GAME_NOT_FOUND: "That code doesn't match a game. Check the screen and try again.",
  GAME_NOT_JOINABLE: 'That game has already finished.',
  GAME_NOT_LIVE: 'That game is not running.',
  TEAM_NOT_FOUND: 'That team is no longer in this game.',
  UNKNOWN_DEVICE: 'This device is no longer in the game. Join again to carry on.',
  TEAM_FULL: 'That team already has the maximum number of phones.',
  QUESTION_NOT_OPEN: 'That question is not open.',
  QUESTION_LOCKED: 'Too late — the quiz master has closed this question.',
  ALREADY_SUBMITTED: 'Your team has already answered this one.',
  BUZZERS_NOT_LIVE: 'Buzzers are not live right now.',
  TEAM_LOCKED_OUT:
    'Your answer was incorrect, so you cannot buzz again on this question.',
  NOT_IN_SETUP: 'That can only be changed before the game starts.',
  GAME_NOT_FINISHED: 'That can only be changed once the game has ended.',
  RESYNC_BLOCKED:
    'This game has already been played, so it cannot be refreshed from the quiz.',
  SOURCE_QUIZ_DELETED: 'The quiz this game came from no longer exists.',
  COPY_INVALID: "The copy this made isn't valid. Please try again or report this.",
  QUESTION_STILL_OPEN: 'Lock or skip the open question first.',
  SCORE_OUT_OF_RANGE: 'That score is outside the range this question allows.',
  NOT_A_FINALE_ROUND: 'That only applies to the finale.',
  TOO_FEW_FINALISTS: 'Pick at least two finalists.',
  FINALISTS_ALREADY_SET: 'The finalists are already set for this round.',
  TEAM_NOT_A_FINALIST: 'That team is not in the finale.',
  TEAM_ELIMINATED: 'That team is out of the finale.',
  NOT_TEAMS_TURN: "It is not that team's turn.",
  NO_TURN_ACTIVE: 'Start a turn first.',
  KEYWORD_ALREADY_MARKED: 'That keyword has already been credited to another team.',
  SCHEMA_VERSION_UNSUPPORTED: 'This file was made by a newer version of Kwiz.',
  CHECKSUM_MISMATCH: 'Some files in this export are damaged.',
  IMPORT_COLLISION: 'You already have this quiz. Replace it, or import a copy?',
  MANIFEST_INVALID: 'This file is not a Kwiz export.',
  VALIDATION_ERROR: 'Something went wrong with that request.',
  DATABASE_MIGRATION_REQUIRED: 'The database needs migrating before Kwiz can run.',
  ATTACHMENT_REJECTED: 'That file is not a supported image, audio or video file.',
  ATTACHMENT_NOT_FOUND: 'That file is missing.',
}

const en = {
  errors,

  common: {
    appName: 'Kwiz',
    cancel: 'Cancel',
    save: 'Save',
    delete: 'Delete',
    create: 'Create',
    add: 'Add',
    rename: 'Rename',
    close: 'Close',
    back: 'Back',
    saved: 'Saved',
    saving: 'Saving…',
    saveFailed: 'Not saved — check your connection.',
    teams: 'Teams',
    dragToReorder: 'Drag to reorder',
    moveUp: 'Move up',
    moveDown: 'Move down',

    /**
     * Language names are **never translated** and are identical in every catalogue
     * (PRD 1 §9.4): both locales must be reachable from a device that cannot read the
     * current one. Never a flag icon alone — flags mean countries, not languages.
     */
    language: {
      label: 'Language',
      en: 'English',
      nl: 'Nederlands',
    },
  },

  /** PRD 2 §3 — the only page a guest and a master both see. */
  landing: {
    playing: {
      title: "I'm playing",
      detail: 'Scan the QR code on screen, or enter the code.',
      codeLabel: 'Game code',
      join: 'Join',
      invalid: "That code doesn't look right.",
    },
    hosting: {
      title: "I'm hosting",
      detail: 'Manage my quizzes and run a game.',
      open: 'Open',
    },
  },

  admin: {
    /** PRD 2 §5 — quizzes above games, and finished games out of the way. */
    dashboard: {
      title: 'Kwiz',
      settings: 'Settings',
      quizzes: 'Quizzes',
      newQuiz: 'New quiz',
      import: 'Import…',
      games: 'Games',
      showFinished: 'Show finished',
      hideFinished: 'Hide finished',
      play: 'Play',
      open: 'Open',
      rounds: '{count, plural, one {# round} other {# rounds}}',
      questions: '{count, plural, one {# question} other {# questions}}',
      teamCount: '{count, plural, one {# team} other {# teams}}',
      edited: 'edited {date}',
      code: 'code {code}',
      roundOf: 'round {number} of {total}',
      winner: 'winner: {name}',
      drawBetween: 'a {count}-way draw',
      templateUpdated: 'Template updated',
      resync: 'Re-sync',
      duplicate: 'Duplicate',
      export: 'Export',
      /** §5 — a real screen, and the moment the database is created (PRD 1 §6.6). */
      emptyQuizzes: 'No quizzes yet.',
      emptyQuizzesDetail: 'Create one, or import a .zip you exported elsewhere.',
      emptyGames: 'No games yet. Press Play on a quiz to set one up.',
      newQuizTitle: 'New quiz',
      newQuizLabel: 'Name',
      newQuizPlaceholder: 'Pub Quiz #4',
      deleteQuizTitle: 'Delete “{name}”?',
      /**
       * §5 names what survives, because masters assume deleting a quiz takes their history with
       * it and therefore never clean up. Games keep their own copies (data model §10).
       */
      deleteQuizKeepsGames:
        '{count, plural, =0 {This quiz has no played games.} one {# played game will be kept and stays reviewable.} other {# played games will be kept and stay reviewable.}}',
      status: {
        SETUP: 'Setup',
        LIVE: 'Live',
        FINISHED: 'Finished',
        ABANDONED: 'Abandoned',
      },
    },

    /** PRD 2 §6 — the round list, and the finale's one legal position. */
    quiz: {
      backToDashboard: 'Dashboard',
      name: 'Name',
      description: 'Description',
      rounds: 'Rounds',
      addRound: 'Add round',
      openRound: 'Open',
      /** §6 — balance between rounds is the thing a master worries about while authoring. */
      totals: '{questions} questions · {points} points · est. {minutes} min',
      roundSummary: '{questions} questions · {points} pts',
      /** A finale scores seconds, not points (D51), so `0 pts` would read as a mistake. */
      roundSummaryFinale: '{questions} questions',
      empty: 'No rounds yet. Add one to start writing questions.',
      addRoundTitle: 'Add a round',
      roundTypeLabel: 'Type',
      roundTitleLabel: 'Title',
      roundTitlePlaceholder: 'Music',
      type: {
        QUESTION_SET: 'Questions',
        JEOPARDY: 'Jeopardy board',
        DSMTW_FINALE: 'Finale',
      },
      typeHint: {
        QUESTION_SET: 'A list of questions, any answer method.',
        JEOPARDY: 'A board of categories and values. Every tile is a buzzer question.',
        DSMTW_FINALE: 'The timed keyword round. Always last, and only one per quiz.',
      },
      /** §6.1 — a one-line reason, rather than a silently missing option. */
      finaleExists: 'This quiz already ends with a finale.',
      finalePinned: 'Pinned as the last round',
      deleteRoundTitle: 'Delete “{title}”?',
      deleteRoundBody:
        '{count, plural, =0 {This round has no questions.} one {Its # question is deleted too.} other {Its # questions are deleted too.}}',
      preflight: 'Check',
    },

    /** PRD 2 §7 — the QUESTION_SET round editor and its side sheet. */
    round: {
      backToQuiz: 'Quiz',
      title: 'Title',
      defaultPoints: 'Default points',
      defaultTimer: 'Default timer',
      seconds: 's',
      noTimer: 'No timer',
      questions: 'Questions',
      addQuestion: 'Add question',
      empty: 'No questions yet.',
      untitled: 'Untitled question',
      /** §7 — a round default silently rewriting a round's scoring is a nasty surprise. */
      cascadeTitle: 'Change the default for this round?',
      cascadeBody:
        '{count, plural, =0 {No questions inherit this default.} one {# question will change from {from} to {to}.} other {# questions will change from {from} to {to}.}}',
      deleteQuestionTitle: 'Delete this question?',
      ready: 'Ready',
      incomplete: 'Incomplete',
    },

    /** PRD 2 §7.1 — the question sheet, over the list rather than on its own page. */
    question: {
      heading: 'Question {index} of {total}',
      previous: 'Previous question',
      next: 'Next question',
      prompt: 'Prompt',
      promptPlaceholder: 'Who released "Kid A" in 2000?',
      answerMethod: 'Answer method',
      method: {
        FREE_TEXT: 'Free text',
        MULTIPLE_CHOICE: 'Multiple choice',
        BUZZER: 'Buzzer',
        DO: 'Do / challenge',
        KEYWORDS: 'Keywords',
      },
      points: 'Points',
      timer: 'Timer',
      noTimer: 'No timer',
      /** §8 and §9.1 — stated as a fact, not shown as a disabled control (D34, I18). */
      lockedBuzzer: 'Jeopardy tiles are always buzzer questions.',
      lockedKeywords: 'A finale question is always a keyword question.',
      deleteOptionTitle: 'Delete this option?',
      correctAnswer: 'Correct answer',
      alsoAccept: 'Also accept',
      addAlternative: 'Add alternative',
      /** §7.2 — telling the master here turns a live-game problem into an authoring one (D22). */
      matchingNote:
        'Matching is exact after lowercasing and trimming. Anything else comes to you to accept or deny during the game.',
      buzzerNote:
        'You will judge spoken answers yourself. This is shown on your control screen and revealed to the room afterwards.',
      options: 'Options',
      optionsHint: 'Two to four, and pick the correct one.',
      addOption: 'Add option',
      scoring: 'Scoring',
      scoringMode: {
        WINNER_TAKES_ALL: 'Winner takes all',
        PER_TEAM_SCORE: 'Score each team',
      },
      tiePayout: 'If several teams tie',
      payout: { FULL: 'Each gets full points', SPLIT: 'Split the points' },
      /** §7.2 — `points` doubling as the per-team maximum is genuinely non-obvious (D24). */
      perTeamNote:
        'Each team gets 0-{points} points. Change "Points" above to change the maximum.',
      attachments: 'Attachments',
      addAttachment: 'Add file',
      /** O6 — verified in the browser before it is uploaded at all. */
      checking: 'Checking...',
      emptyAttachments: 'No media on this question yet.',
      playable: 'Playable',
      showOnPlayers: 'Show on player devices',
      showOnPlayersHint: 'Images only. Audio and video play on the main screen.',
      deleteAttachment: 'Remove file',
      previewOnScreen: 'Preview on main screen',
      masterNotes: 'Master notes',
      /** §7.1 — labelled with its guarantee, which is why a master will trust it (invariant 7). */
      masterNotesHint: 'Never shown to anyone else.',
      keywords: 'Keywords',
      keywordsHint: 'Exactly five.',
      keywordRequired: 'Required',
      wordShape: '{count, plural, one {# word} other {# words}}',
      /** §9.1 — the shape is what the room sees, and it changes authoring decisions (D53). */
      keywordShapeNote:
        'The room sees blurred word shapes until you mark each one. "wrought iron" shows as two blurred words of 7 and 4 letters.',
    },

    /** PRD 2 §8 — the board is authored as a board, because that is what the room will see. */
    board: {
      valueLadder: 'Value ladder',
      addRow: 'Add row',
      addCategory: 'Add category',
      categoryName: 'Category name',
      moveCategoryLeft: 'Move left',
      moveCategoryRight: 'Move right',
      renameCategory: 'Rename category',
      deleteCategoryTitle: 'Delete "{name}"?',
      deleteCategoryBody:
        '{count, plural, =0 {It has no tiles.} one {Its # tile is deleted too.} other {Its # tiles are deleted too.}}',
      everyTileBuzzer: 'Every tile is a buzzer question - any team can buzz in.',
      addTile: 'Add a tile',
      emptyBoard: 'No categories yet. Add one to start building the board.',
      emptyTiles: '{count, plural, one {# empty tile} other {# empty tiles}}',
      incompleteTiles:
        '{count, plural, one {# incomplete question} other {# incomplete questions}}',
    },

    /** PRD 2 §9 — the finale editor: a list of keyword questions plus the two numbers. */
    finale: {
      pinnedNote: 'Pinned as the last round. A quiz can have at most one finale.',
      rate: 'Points to seconds',
      rateSuffix: 'points = 1 second',
      /** §9 — the conversion shown *working*, not just entered. */
      rateWorked: 'A team on {score} pts starts with {seconds}s.',
      rateQuizTotal:
        'Your quiz is worth {points} pts - a strong team is about {seconds}s.',
      penalty: 'Penalty per keyword',
      penaltySuffix: 's off every other team',
      penaltyNote: 'Set at game setup too, once you know how many teams play.',
      suggested: '{have} of ~{suggested} suggested',
      assumeTeams: 'Assume {count} teams',
      /** §9 — a shortfall is a warning, never a block: over-supplying costs nothing (D58). */
      shortfall:
        'For {teams} teams at {penalty}s, about {suggested} questions are usually needed to get down to one survivor. You have {have}.',
      keywordCount: '{count, plural, one {# keyword} other {# keywords}}',
    },

    /** PRD 2 §10 — run when [Play] is pressed. §1.1 is why it exists. */
    preflight: {
      heading: '{name} - ready to play?',
      problems:
        '{count, plural, one {# problem must be fixed} other {# problems must be fixed}}',
      warnings:
        '{count, plural, one {# thing worth a look} other {# things worth a look}}',
      healthy:
        '{questions} questions, {attachments} attachments verified, {rounds} rounds',
      fix: 'Fix',
      view: 'View',
      /** §10 — deliberately available even with errors: blocking protects data at the event's cost. */
      playAnyway: 'Play anyway',
      fixProblems: 'Fix problems',
      setUpGame: 'Set up the game',
      round: 'Round {number}',
      code: {
        EMPTY_PROMPT: 'no question text',
        NO_ACCEPTED_ANSWER: 'no correct answer',
        MC_NEEDS_ONE_CORRECT: 'needs two to four options with exactly one correct',
        DO_NO_SCORING_MODE: 'no scoring mode chosen',
        ATTACHMENT_MISSING: 'a file is missing from disk or has changed',
        FINALE_KEYWORD_COUNT: 'needs exactly five keywords, has {count}',
        FINALE_KEYWORD_BLANK: '{count} of 5 keywords have text - one is blank',
        MULTIPLE_FINALES: 'a quiz can only have one finale',
        FINALE_NOT_LAST: 'the finale has to be the last round',
        FINALE_RATE_MISSING: 'no points-to-seconds rate set',
        KEYWORDS_OUTSIDE_FINALE: 'keyword questions only belong in a finale',
        FINALE_QUESTION_NOT_KEYWORDS: 'a finale question has to be a keyword question',
        ROUND_EMPTY: 'no questions in this round',
        SINGLE_ACCEPTED_ANSWER: 'only one accepted answer, so near-misses come to you',
        SHORT_TIMER: 'only {seconds}s to answer',
        JEOPARDY_UNEVEN_COLUMNS: 'columns are uneven - the tallest has {tallest}',
        JEOPARDY_EMPTY_TILES: '{empty} empty tiles',
        FINALE_RATE_SUSPICIOUS:
          'the top team would start with only {seconds}s - the rate may be inverted',
        FINALE_TOO_FEW_QUESTIONS:
          '{teams} teams usually need about {suggested} questions; you have {have}',
      },
    },

    /** PRD 2 §11 — game setup, against the clock in a noisy room (§1.1). */
    setup: {
      heading: 'New game from "{name}"',
      teams: 'Teams',
      addTeam: 'Add team',
      /** §11 — the same pub tends to have the same teams, and re-typing eight names costs time. */
      copyFromLast: 'Copy from last game',
      teamName: 'Team name',
      defaultTeamName: 'Team {number}',
      colour: 'Colour',
      customColour: 'Custom',
      colourTooDark: 'Too dark to read on the projected screen.',
      colourTaken: 'already used',
      removeTeam: 'Remove team',
      playerLanguage: 'Player language',
      playerLanguageHint: 'Players can change this on their own phone.',
      createGame: 'Create game',
      /** §11.1 — shown only when the quiz ends in a finale, because the penalty depends on this. */
      finaleHeading: 'This quiz ends with a finale.',
      teamsPlaying: '{count, plural, one {# team playing} other {# teams playing}}',
      penaltyReach: 'With {teams} teams, 5 keywords can remove up to {seconds}s.',
      penaltyWarning: 'At this penalty a single question can end the round.',
      rateFromQuiz: '{rate} points = 1 second (from the quiz)',
      questionsOk: 'About {suggested} are usually needed for these {teams} teams.',
      questionsShort:
        'The finale has {have, plural, one {# question} other {# questions}}. About {suggested} are usually needed for these {teams} teams.',
      /**
       * §11.1's quick fix for a question shortfall — "raising the drain per question is often
       * the easier fix... than writing three more keyword questions." A higher penalty drains
       * banks faster, so *fewer* questions are needed to reach one survivor — the opposite of
       * what this key's old name (`lowerPenalty`) said, which is why it was never wired up
       * correctly. Renamed rather than shipped under a label that describes the wrong direction.
       */
      raisePenalty: 'Raise the penalty to {seconds}s',
    },

    /** PRD 2 §12 — the hub for one game, before, during and after. */
    game: {
      join: 'Join',
      code: 'Code',
      regenerate: 'New code',
      /** §12 — the obvious fear is that a new code kicks everyone out. It does not. */
      regenerateTitle: 'Generate a new code?',
      regenerateBody: 'Devices that have already joined keep working.',
      openMainScreen: 'Open main screen',
      openControl: 'Open control screen',
      teams: 'Teams',
      devices: '{count, plural, =0 {no devices} one {# device} other {# devices}}',
      devicesJoined: '{count} of {total} devices joined',
      rounds: '{rounds} rounds, {questions} questions',
      notStarted: 'not started',
      noAddress: 'Choose a network address to show a QR code players can scan.',
      staleTitle: 'Template updated since this game was created',
      staleBody:
        'Teams, devices and the join code are kept. Questions are refreshed from the quiz.',
      resync: 'Re-sync',
      addTeam: 'Add team',
      abandon: 'Abandon game',
      abandonTitle: 'Abandon this game?',
      abandonBody: 'It ends without being marked finished. The room is mid-quiz.',
      deleteGame: 'Delete game',
      deleteTitle: 'Delete this game?',
      deleteBody:
        'This game, its {teams} teams and all its answers go. The quiz itself is kept.',
      exportGame: 'Export this game',
    },

    /** PRD 2 §16 — "small and boring on purpose". */
    settings: {
      title: 'Settings',
      network: 'Network',
      noAddress: 'No address chosen yet, so join links stay relative to this browser.',
      addressStale:
        'This address is no longer on any adapter. Pick it again before the room arrives.',
      changeAddress: 'Change address',
      language: 'Language',
      languageHint: 'This device only. It does not change what players see.',
      sound: 'Sound',
      muteAll: 'Mute all quiz sounds',
      storage: 'Storage',
      dataDir: 'Data directory',
      databaseSize: 'Database',
      attachments: 'Attachments',
      attachmentSummary: '{count, plural, one {# file} other {# files}}, {size}',
      reclaim: 'Reclaim space',
      reclaimable: '{count, plural, one {# unused file} other {# unused files}}, {size}',
      nothingToReclaim: 'Nothing to reclaim.',
      reclaimed: 'Removed {count, plural, one {# file} other {# files}}, freeing {size}.',
      about: 'About',
      appVersion: 'Version',
      schemaVersion: 'Export format',
      migrationStatus: 'Database',
      migration: {
        UP_TO_DATE: 'Up to date',
        CREATED: 'Created and migrated',
        APPLIED: 'Migrations applied',
        DECLINED: 'Migrations pending - the server is running read-only',
      },
    },

    /** PRD 2 §7.1 / O4 — the real PRD 4 renderer, scaled, in a mock OPEN state. */
    preview: {
      title: 'On the main screen',
      body: 'The projected screen at its real proportions. Check the prompt fits and the image survives a projector.',
    },
    /** PRD 2 §11.2 / O5 — a table arriving mid-game, and the arithmetic that makes it a decision. */
    addTeam: {
      title: 'Add a team',
      titleMidGame: 'Add a team mid-game?',
      inProgress: 'Round {round} of {total} is in progress.',
      missed:
        'This team has missed {questions, plural, one {# question} other {# questions}} worth {points} points.',
      ceiling: 'Their maximum possible score is now {theirs} (others: {others}).',
      startingScore: 'Starting score',
      startOnZero: 'Start on 0',
      givePoints: 'Give them',
      halfOfMissed: 'points - half of what they missed is {suggested}',
      adjustmentReason: 'joined during round {round}',
      recordedAs: 'Recorded as a score adjustment with the reason "{reason}".',
      cancel: 'Cancel',
      addTeam: 'Add team',
    },
    /** PRD 2 §14.1 — sizes are computed, not estimated. */
    export: {
      title: 'Export "{name}"',
      body: 'Everything needed to run this quiz on another machine.',
      quizOnly: 'Quiz only',
      quizOnlyHint: 'For taking to another machine.',
      withGames: 'Quiz + {count, plural, one {# played game} other {# played games}}',
      withGamesHint: 'For archiving a night, with every answer and score.',
      includeAttachments:
        'Include attachments ({count, plural, one {# file} other {# files}}, {size})',
      includeAttachmentsPlain: 'Include attachments',
      cancel: 'Cancel',
      export: 'Export',
    },

    /** §14.2 — the dialog that stands between a master and deleting their own work. */
    import: {
      importButton: 'Import…',
      title: 'Import "{name}"',
      summary:
        '{rounds, plural, one {# round} other {# rounds}}, {questions, plural, one {# question} other {# questions}}.',
      missingMedia:
        '{count, plural, one {# file is} other {# files are}} missing or damaged. Everything else imports; you can re-upload the media afterwards.',
      collision: 'You already have a quiz with this identity.',
      field: 'Property',
      onThisMachine: 'On this machine',
      inThisFile: 'In this file',
      edited: 'Edited',
      rounds: 'Rounds',
      roundsValue: '{rounds} · {questions} questions',
      games: 'Games',
      gamesValue: '{count, plural, one {# played} other {# played}}',
      fileIsOlder: 'The file is older than your local copy.',
      fileIsNewer: 'The file is newer than your local copy.',
      asCopy: 'Import as a separate copy',
      replace: 'Replace my local copy',
      replaceCost:
        'Deletes it and {games, plural, =0 {no games} one {its # game} other {its # games}}.',
      cancel: 'Cancel',
      import: 'Import',
    },
  },

  /**
   * PRD 3 — the control desk. Read in **two-second glances** by someone standing with a microphone,
   * so the copy is short and names the thing rather than describing it: `[Pass to Team 4]`, not
   * "hand the turn over to the next team".
   */
  control: {
    /** §2's frame: header, status, and the overflow menu. */
    frame: {
      round: 'Round {number} of {total}',
      notStarted: 'Not started',
      code: 'Code {code}',
      mainScreen: 'Main screen',
      connecting: 'Connecting…',
      /** §12 — passive, because two desks are legitimate and every action is idempotent. */
      otherScreens:
        '{count, plural, one {# other control screen} other {# other control screens}}',
      reconnecting: 'Reconnecting…',
      menu: 'Game menu',
      skipQuestion: 'Skip this question',
      closeRound: 'End this round',
      finish: 'End the game',
      abandon: 'Abandon the game',
      finishTitle: 'End the game?',
      finishBody: 'The main screen shows the final scores. Nothing more can be played.',
      abandonTitle: 'Abandon the game?',
      abandonBody: 'Every screen disconnects. The game is kept but cannot be resumed.',
      finished: 'This game has finished.',
      abandoned: 'This game was abandoned.',
    },

    /** §4 — the only thing this screen is for is finding the table that hasn't scanned yet. */
    setup: {
      title: 'Waiting for players',
      joined: '{joined} of {total} teams have joined.',
      devices: '{count, plural, one {# device} other {# devices}}',
      ready: 'ready',
      notJoined: 'not joined yet',
      start: 'Start the quiz',
    },

    /** §5 — the open question, its answers, and the reveal. */
    question: {
      points: '{points} pts',
      notes: 'Note',
      answer: 'Answer',
      alsoAccepted: 'also: {answers}',
      media: 'Audio and video play from here, never from the main screen.',
      mediaFailed: 'This file will not play on this machine.',
      play: 'Play',
      pause: 'Pause',
      answersSoFar: 'Answers so far',
      ofTeams: '{answered} of {total} teams',
      stillAnswering: 'still answering',
      timeUp: 'Time up',
      submitted: '{answered} of {total} submitted',
      close: 'Close answers',
      lockedLine: 'Locked · {answered} of {total} answered',
      unjudged: '{count, plural, one {# unjudged} other {# unjudged}}',
      allJudged: 'all judged',
      reveal: 'Reveal answer',
      revealed: 'Showing “{answer}” to the room',
      showOnScreen: 'Show on screen',
      onScreen: 'On screen',
      spotlightHint: 'Multiple choice shows the whole distribution — nothing to pick.',
      buzzerNothing: 'One team answered, out loud. Nothing to show.',
      next: 'Next question',
      openNext: 'Open the next question',
      score: 'Award the points',
      nextRound: 'Start the next round',
      finishGame: 'End the game',
      /** §11.3 — only when the team has no device at all, so it never reads as a shortcut. */
      cantConnect: "can't connect — enter answer",
      enterFor: 'Answer for {team}',
      submitFor: 'Save it',
      enteredByMaster: 'entered by quizmaster',
      notConfirmed: 'not confirmed',
      accept: 'Accept',
      deny: 'Deny',
      correct: 'correct',
      wrong: 'wrong',
      auto: 'auto',
      failsPreflight: 'Pre-flight flagged this question — you chose to play it anyway.',
    },

    /** §6 — the round-end sweep, grouped by question so inconsistency is visible. */
    validate: {
      title: 'Still to judge',
      remaining:
        '{count, plural, =0 {last one} one {# more question after this} other {# more questions after this}}',
      accepted: 'Accepted: {answers}',
      identical: 'same answer as another team',
      done: 'Done with this question',
    },

    /** §7 — the most time-critical screen in the product. Two buttons, nothing else. */
    buzz: {
      buzzedAt: 'buzzed at {seconds}s',
      timerPaused: 'timer paused',
      correct: 'Correct',
      wrong: 'Wrong',
      alsoBuzzed: 'Also buzzed',
      lockedOut: 'Locked out',
      nobodyYet: '—',
      liveAgain: 'Buzzers are live again.',
      waiting: 'Waiting for a buzz…',
      canStillBuzz:
        '{count, plural, one {# team can still buzz} other {# teams can still buzz}}',
      reopen: 'Reopen for everyone',
      nobodyGotIt: 'Nobody got it.',
    },

    /** §8 — both `DO` modes (D23, D24). */
    do: {
      whoWon: 'Who won?',
      tieHint: 'tap more than one for a tie',
      nobody: 'Nobody got it',
      awardEach: 'Award {points} pts each',
      awardSplit: 'Split {points} pts',
      award: 'Award {points} pts',
      scoreEach: 'Score each team',
      max: 'max {points} each',
      scored: '{scored} of {total} scored',
      save: 'Save scores',
    },

    /** §9 — the board is the master's input device (D16). */
    jeopardy: {
      picks: '{team} picks next',
      nobodyPicks: 'Nobody is picking yet',
      change: 'Change',
      hint: 'Hover or focus a tile to read its question.',
      /** Count-aware: the lowest-score rule can tie three or four ways, not only two. */
      tieTitle: '{count} teams are level. Who picks?',
      played: 'played',
    },

    /** §10 — the finale desk. Clocks are running; every label is as short as it can be. */
    finale: {
      whoPlays: 'Who plays the finale?',
      rate: '{points} points = 1 second',
      seconds: '{seconds}s',
      outAtOnce: 'out at once',
      penaltyLine: 'Penalty per keyword: {penalty}s → up to {max}s off a {pool}s pool',
      suggested: 'Suggested: {count} questions',
      start: 'Start the finale',
      needTwo: 'Pick at least two finalists.',
      questionOf: 'Q{number} of {total}',
      next: 'next: {team}',
      nextNobody: 'last one in',
      mark: 'mark',
      unmark: 'Un-mark',
      markedBy: '{team}',
      revealedUnguessed: 'nobody',
      pass: 'Pass to {team}',
      startTurn: 'Start {team}',
      allPassed: 'All teams passed',
      unguessed: '{count, plural, one {# unguessed} other {# unguessed}}',
      revealRemaining: 'Reveal remaining',
      nextQuestion: 'Next question',
      out: 'out {time}',
      eliminated: 'out',
      /** §10.6 — the two tabs (D51). */
      rankingTitle: 'Finale over',
      survivalTab: 'Survival',
      pointsTab: 'Points before the finale',
      place: '#{place}',
      shared: 'joint #{place}',
    },

    /** §11 — the right rail, available at all times (D15). */
    scores: {
      title: 'Scores',
      devicesLine: '{joined} of {total} teams connected',
      noDevice: 'no device',
      adjust: 'Adjust',
      adjustTitle: 'Adjust · {team}',
      amount: 'Amount',
      reason: 'Reason (optional)',
      reasonPlaceholder: 'best heckle of the night',
      announce: 'Announce on the main screen',
      apply: 'Apply {delta}',
      recent: 'Recent adjustments',
      undo: 'Undo',
      undone: 'undone',
      showScores: 'Show scores on screen',
      hideScores: 'Take scores off screen',
      toValidate:
        '{count, plural, one {# answer to validate} other {# answers to validate}}',
      buzzInterrupt: 'A buzz came in — finish or cancel.',
    },

    /** §11.2 — nothing in this product auto-advances (D8), including the end of a break. */
    break: {
      title: 'On a break',
      startTitle: 'Start a break',
      minutes: 'Minutes',
      minutesHint: 'Leave it blank for “back shortly” with no clock.',
      start: 'Start break',
      extend: 'Extend break',
      resume: 'Resume',
      backIn: 'Back in {time}',
      noClock: 'No clock — back shortly',
      blocked: 'Lock or skip the open question first.',
    },

    /** §2.1 — read-only. Clicking a past question navigates; it never reopens anything. */
    timeline: {
      label: 'This round',
      preflight: 'flagged by pre-flight',
      current: 'now',
      state: {
        PENDING: 'not played',
        OPEN: 'open',
        LOCKED: 'closed',
        REVEALED: 'revealed',
        SCORED: 'scored',
        SKIPPED: 'skipped',
      },
    },
  },

  /** PRD 2 §4 / D10 — the screen that stops a dead QR code from being the first thing a room sees. */
  setup: {
    heading: 'Which address should players use?',
    body: 'This laptop has several. Players need the one on the same network as their phones.',
    noAddresses: 'No network addresses found. Is this machine connected to a network?',
    continue: 'Continue',
    reason: {
      PRIVATE: 'reachable',
      PUBLIC: 'public address',
      VIRTUAL: 'no route from other devices',
      LOOPBACK: 'this machine only',
      LINK_LOCAL: 'no network assigned',
    },
    probe: {
      start: 'Test with my phone',
      waiting: 'Scan this with a phone on the venue wifi.',
      confirmed: 'Your phone reached this machine.',
      cancel: 'Cancel',
      /** Rendered on the phone, so it is player copy: short, and it answers "did it work?". */
      reached: 'You reached the quiz laptop.',
      reachedBody: 'This network works. Hand the phone back to the quiz master.',
    },
  },

  /**
   * PRD 4 — the projected screen.
   *
   * **Full EN/NL parity is required here** (D28): this and the player device are the two surfaces an
   * audience reads, and Dutch runs 20–30% longer while being this screen's layout baseline
   * (PRD 1 §9.2). Every string below is short on purpose — at §2.1's sizes there is room for very
   * little, and a sentence that fits in English and wraps to three lines in Dutch breaks the stage.
   */
  screen: {
    /** §4.1 — the one click that arms audio and fullscreen. Addressed to the master, not the room. */
    arming: {
      click: 'Click anywhere to start',
      explain: 'This enables sound and fullscreen for the quiz.',
    },
    waiting: {
      scanOrGoTo: 'Scan, or go to',
      andEnter: 'and enter',
      /** §4.1's verification, so a muted projector is found while the room is still filling. */
      soundReady: 'sound ready',
      soundFailed: 'Sound could not start. Click the screen once more.',
    },
    round: {
      number: 'ROUND {number}',
      shape: '{questions} questions · {points} points',
    },
    leaderboard: {
      afterRound: 'After round {number}',
      currentScores: 'Current scores',
      provisional: 'scores provisional · {questions} answers still being checked',
      /** Read out only by a screen reader — the room sees the arrow (§10). */
      movementUp: 'up {places}',
      movementDown: 'down {places}',
      movementHeld: 'no change',
    },
    break: {
      backIn: 'Back in',
      /** §11 — no duration given, so no clock rather than an invented number. */
      backShortly: 'Back shortly',
      /** §11 — zero holds, and the master resumes when the room is actually back. */
      startingSoon: 'Starting soon',
    },
    question: {
      /** §7 — at zero the timer holds and says this; the question is still open (D8). */
      timeUp: 'Time',
      /** §7 — paused while the master adjudicates a buzz (D35). Screen readers only; the room sees ⏸. */
      paused: 'paused',
      /** §8.3 — hero scale on a denial, loud enough to be caught peripherally. */
      buzzersOpen: 'Buzzers open',
    },
    board: {
      /** §9 — the only instruction the room needs, and it prevents the "whose turn?" pause. */
      picks: '{team} pick',
      /** No picker yet: the master is breaking a tie, so the room is told nothing rather than a name. */
      choosing: 'Choosing who picks…',
    },
    /** §12 — the busiest this screen ever gets, so every string here is two words or fewer. */
    finale: {
      question: 'Q{number} / {total}',
      /** §12.2's `← guessing` marker on the team whose clock is running. */
      guessing: 'guessing',
      /** §12.2 — between turns nothing ticks, and the room should see that it costs nobody. */
      betweenTurns: 'Next team to go…',
      /** §12.2 / §12.4 — eliminated teams stay listed, greyed, reading this. */
      out: 'Out',
    },
    finished: {
      /** §10.2 — `RESULT` decides the game; `POINTS` is kept because it is often a different story. */
      tabResult: 'Result',
      tabPoints: 'Points',
      survived: 'survived',
      /** "won with 41 seconds left" is the story (§10.2). */
      survivedWith: 'survived · {seconds}s left',
      /** conventions §8.2's `HH:mm` — a time of night, not a duration. */
      outAt: 'out {at}',
      /** §10.2 — labelled so nobody reads a non-finalist's position as an elimination. */
      didNotPlay: 'did not play the finale',
    },
  },
}

export type Messages = typeof en

export default en
