import { Component, ElementRef, OnDestroy, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterOutlet } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiHealthService } from './core/api-health.service';
import {
  ShoppingItem,
  ShoppingItemsService,
  type ShopTypeFacet,
  type ShoppingListArchive,
} from './core/shopping-items.service';
import { ShoppingEventsService } from './core/shopping-events.service';
import { ListPreferences } from './core/list-preferences';
import { sortShoppingItems, type ShoppingItemSort } from './core/shopping-item-sort';
import { UnitHistoryCache, type UnitHistoryMap } from './core/unit-history-cache';
import { CaptureCombobox } from './capture-assistance/capture-combobox';
import type { CaptureSuggestion, ClarificationCandidate, SemanticSuggestion } from '@duckworth/local-assistance';
import { CaptureAssistanceService, type SpellingDecision } from './core/capture-assistance.service';
import { HouseholdVocabulary } from './core/household-vocabulary';
import { PersonalVocabularyStore } from './core/personal-vocabulary-store';
import { SpellingClarification } from './spelling-clarification/spelling-clarification';
import { LanguageSettings, type LanguageSettingsChange } from './language-settings/language-settings';
import { HouseholdSettings } from './household-settings/household-settings';
import type { LanguagePackBundle } from './core/language-pack-repository';
import type { RegionalProductPack } from './core/regional-product-repository';
import {
  formatBrandName,
  formatItemName,
  formatMeasurement,
  formatUnitLabel,
  measurementAriaLabel,
  unitAriaLabel,
} from './core/display-formatters';
import {
  ConversationService,
  type ClarificationDraft,
  type ConversationCaptureResult,
  type UndoToken,
} from './core/conversation.service';
import { ConversationContextService } from './core/conversation-context.service';
import { ConversationLifecycleService } from './core/conversation-lifecycle.service';
import { HouseholdLearningService, type HouseholdQualityMetrics, type LearnedSemanticEntry, type SemanticCorrectionRecord } from './core/household-learning.service';
import { classificationHintKey } from './core/classification-hints';
import { expectedLaneForOrigin, verifyRuntimeIdentity, type RuntimeIdentity, type RuntimeLane } from './core/runtime-identity';
import { SessionService } from './core/session.service';
import { CloudAssistService, type CloudAssistSuggestion } from './core/cloud-assist.service';
import { HouseholdSettingsService, type HouseholdCaptureSettings } from './core/household-settings.service';

type ApiStatus = 'checking' | 'ready' | 'offline' | 'misconfigured';
type CapturePreview = {
  captureText: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  packageSize: number | null;
  packageUnit: string | null;
  unitSource: 'explicit' | 'history' | null;
  brandName?: string;
};

type CloudSuggestionState = {
  suggestion: CloudAssistSuggestion;
  acceptanceToken: string;
  source: string;
  expiresAt: string;
};

@Component({
  selector: 'app-root',
  imports: [FormsModule, RouterOutlet, TitleCasePipe, CaptureCombobox, SpellingClarification, LanguageSettings, HouseholdSettings],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnDestroy {
  private readonly apiHealth = inject(ApiHealthService);
  private readonly session = inject(SessionService);
  private readonly shoppingItems = inject(ShoppingItemsService);
  private readonly shoppingEvents = inject(ShoppingEventsService);
  private readonly conversation = inject(ConversationService);
  private readonly conversationContext = inject(ConversationContextService);
  private readonly conversationLifecycle = inject(ConversationLifecycleService);
  private readonly householdLearning = inject(HouseholdLearningService);
  private readonly captureAssistance = inject(CaptureAssistanceService);
  private readonly householdSettings = inject(HouseholdSettingsService);
  private readonly cloudAssist = inject(CloudAssistService);
  private readonly documentTitle = inject(Title);
  protected readonly householdId = localStorage.getItem('duckworth.household-id') ?? 'household-demo';
  private readonly deviceProfileId = 'local-device';
  private readonly contextDeviceId = this.getOrCreateContextDeviceId();
  protected readonly currentContext = this.conversationContext.current;
  protected readonly conversationState = this.conversationLifecycle.state;
  private readonly unitHistoryCache = new UnitHistoryCache(localStorage);
  private readonly listPreferences = new ListPreferences(localStorage, this.deviceProfileId);
  private readonly householdVocabulary = new HouseholdVocabulary('en-IN');
  private personalVocabulary: PersonalVocabularyStore | null = null;
  protected readonly unitHistory = signal<UnitHistoryMap>(this.unitHistoryCache.read(this.householdId));
  protected readonly apiStatus = signal<ApiStatus>('checking');
  protected readonly runtimeIdentity = signal<RuntimeIdentity | null>(null);
  protected readonly items = signal<ShoppingItem[]>([]);
  protected readonly learnedEntries = signal<LearnedSemanticEntry[]>([]);
  protected readonly learningCorrections = signal<SemanticCorrectionRecord[]>([]);
  protected readonly learningMetrics = signal<HouseholdQualityMetrics | null>(null);
  protected readonly personalVocabularyEnabled = signal(true);
  private readonly activeLanguageBundle = signal<LanguagePackBundle | null>(null);
  private readonly installedLanguageBundles = signal<LanguagePackBundle[]>([]);
  private readonly regionalProducts = signal<RegionalProductPack | null>(null);
  private readonly activeLocale = signal('en-IN');
  private readonly enabledLocales = signal<string[]>(['en-IN']);
  protected readonly sortMode = signal<ShoppingItemSort>(this.listPreferences.readSort(this.householdId));
  protected readonly selectedShopTypeId = signal<string | null>(null);
  protected readonly availableShopTypes = signal<ShopTypeFacet[]>([]);
  protected readonly sortedItems = computed(() => sortShoppingItems(
    this.items().filter((item) => item.status !== 'removed' && (
      this.selectedShopTypeId() === null
      || (this.selectedShopTypeId() === 'unassigned' && item.status === 'active' && (item.shopTypes?.length ?? 0) === 0)
      || (item.status === 'active' && item.shopTypes?.some((shopType) => shopType.id === this.selectedShopTypeId()))
    )),
    this.sortMode(),
  ));
  protected readonly shopTypeFacets = computed<ShopTypeFacet[]>(() => {
    const activeItems = this.items().filter((item) => item.status === 'active');
    const unassignedCount = activeItems.filter((item) => (item.shopTypes?.length ?? 0) === 0).length;
    const definitions = this.availableShopTypes().length > 0
      ? this.availableShopTypes()
      : [...new Map(activeItems.flatMap((item) => item.shopTypes ?? []).map((tag) => [tag.id, tag])).values()]
        .map((tag) => ({ ...tag, activeDistinctCount: 0 }));
    const assigned = definitions.filter((definition) => definition.id !== 'unassigned').map((definition) => ({
      ...definition,
      activeDistinctCount: activeItems.filter((item) => item.shopTypes?.some((tag) => tag.id === definition.id)).length,
    }));
    return unassignedCount > 0
      ? [...assigned, { id: 'unassigned', label: 'Unassigned', activeDistinctCount: unassignedCount }]
      : assigned;
  });
  protected readonly assignableShopTypeFacets = computed(() => this.shopTypeFacets().filter((facet) => facet.id !== 'unassigned'));
  protected readonly recentlyRemovedItems = computed(() => this.items()
    .filter((item) => item.status === 'removed')
    .sort((left, right) => (right.removedAt ?? '').localeCompare(left.removedAt ?? '')));
  protected readonly activeCount = computed(() => this.items().filter((item) => item.status === 'active').length);
  protected readonly itemName = signal('');
  protected readonly capturePreview = computed<CapturePreview | null>(() => {
    const input = this.itemName();
    if (!input.trim()) return null;
    const parsed = {
      captureText: input.trim(),
      name: input.trim().replace(/\s+/gu, ' '),
      quantity: hasInlineQuantity(input) ? null : 1,
      unit: hasInlineQuantity(input) ? null : 'piece',
      packageSize: null,
      packageUnit: null,
    };
    const historical = this.unitHistory()[normalizeUiKey(parsed.name)];
    if (historical) return { ...parsed, unit: historical.unit, unitSource: 'history' };
    return { ...parsed, unitSource: null };
  });
  protected readonly captureErrorMessage = signal('');
  protected readonly captureConfirmedUnit = signal<string | null>(null);
  private readonly acceptedProduct = signal<{ productId: string; text: string } | null>(null);
  private readonly acceptedSuggestion = signal<SemanticSuggestion | null>(null);
  protected readonly clarificationCandidate = signal<ClarificationCandidate | null>(null);
  protected readonly message = signal('');
  protected readonly capturePrivacyMessage = signal('');
  protected readonly cloudSuggestion = signal<CloudSuggestionState | null>(null);
  protected readonly cloudLookupPending = signal(false);
  protected readonly pairingRequired = signal(false);
  protected readonly pairingCode = signal('');
  protected readonly pairingPending = signal(false);
  protected readonly lastRemovedItem = signal<ShoppingItem | null>(null);
  protected readonly rowMessages = signal<Record<string, string>>({});
  protected readonly addPending = signal(false);
  protected readonly archivePending = signal(false);
  protected readonly archiveConfirming = signal(false);
  protected readonly archiveHistoryOpen = signal(false);
  private cloudAssistTypingTimer: ReturnType<typeof setTimeout> | null = null;
  private cloudAssistRequestVersion = 0;
  protected readonly listArchives = signal<ShoppingListArchive[]>([]);
  private readonly archiveHistoryLoaded = signal(false);
  protected readonly conversationResult = signal<ConversationCaptureResult | null>(null);
  protected readonly openConversationDrafts = computed(() => (
    this.conversationResult()?.drafts.filter((draft) => draft.status === 'open') ?? []
  ));

  ngOnDestroy(): void {
    if (this.cloudAssistTypingTimer) clearTimeout(this.cloudAssistTypingTimer);
    this.cloudAssistRequestVersion += 1;
  }
  protected readonly reviewingDraftId = signal<string | null>(null);
  protected readonly draftResolutionText = signal('');
  protected readonly editingId = signal<string | null>(null);
  protected readonly editDraft = signal('');
  protected readonly detailsEditingId = signal<string | null>(null);
  protected readonly detailsNameDraft = signal('');
  protected readonly detailsQuantityDraft = signal('');
  protected readonly detailsUnitDraft = signal('');
  protected readonly detailsPackageSizeDraft = signal('');
  protected readonly detailsPackageUnitDraft = signal('');
  protected readonly detailsLearnCorrection = signal(false);
  protected readonly detailsOriginalUnit = signal<string | null>(null);
  protected readonly shopTypeEditingItemId = signal<string | null>(null);
  protected readonly pendingItemIds = signal<ReadonlySet<string>>(new Set());
  private readonly detailsQuantityInput = viewChild<ElementRef<HTMLInputElement>>('detailsQuantityInput');
  private readonly detailsFocusEffect = effect(() => {
    if (this.detailsEditingId()) this.detailsQuantityInput()?.nativeElement.focus();
  });
  private readonly lifecycleHydrationEffect = effect(() => {
    const state = this.conversationLifecycle.state();
    if (!state?.session) return;
    untracked(() => this.conversationResult.update((current) => ({
      session: state.session!,
      pendingAction: state.pendingAction,
      saved: current?.saved ?? [],
      merged: current?.merged ?? [],
      drafts: state.drafts,
      undo: current?.undo ?? [],
    })));
  });

  constructor() {
    this.apiHealth.check().subscribe({
      next: (health) => {
        const expectedLane = expectedLaneForOrigin(globalThis.location?.origin ?? '');
        if (expectedLane && health.lane) {
          try {
            verifyRuntimeIdentity({ lane: expectedLane }, health);
          } catch {
            this.apiStatus.set('misconfigured');
            this.message.set('This page is connected to the wrong data lane.');
            return;
          }
        }
        const identity: RuntimeIdentity = {
          lane: health.lane ?? expectedLane ?? 'sandbox',
          instanceId: health.instanceId ?? globalThis.location?.host ?? 'local-instance',
        };
        this.initializeVerifiedRuntime(identity);
        this.apiStatus.set('ready');
      },
      error: () => this.apiStatus.set('offline'),
    });
  }

  private initializeVerifiedRuntime(identity: RuntimeIdentity): void {
    this.runtimeIdentity.set(identity);
    this.personalVocabulary = new PersonalVocabularyStore(localStorage, this.deviceProfileId, 'en-IN', {
      lane: identity.lane,
      instanceId: identity.instanceId,
      householdId: this.householdId,
    });
    this.documentTitle.setTitle(runtimeTitle(identity.lane));
    this.configureAssistance();
    this.loadItems();
    this.restoreConversationState();
    this.shoppingEvents.connect(this.householdId).subscribe({
      next: ({ action, item }) => {
        if (action === 'created' && item.status === 'active') {
          this.items.update((items) => items.some((candidate) => candidate.id === item.id) ? items : [...items, item]);
        }
        if (action === 'updated') {
          this.items.update((items) => items.map((candidate) => candidate.id === item.id ? item : candidate));
        }
        this.rememberExplicitUnit(item);
        this.refreshAssistanceItem(item);
        if (action === 'created') this.observeAuthoritativeSpelling(item.name);
      },
    });
  }

  protected addItem(): void {
    if (this.addPending()) return;
    const name = this.itemName().trim();
    if (!name) {
      this.message.set('Enter an item name first.');
      return;
    }
    if (this.captureConfirmedUnit() && !this.acceptedSuggestion()) {
      this.addLegacyItem(name);
      return;
    }
    this.addPending.set(true);
    this.message.set('');
    this.conversation.capture(
      this.householdId,
      name,
      this.currentContext() ?? undefined,
      'text',
      this.conversationState()?.list.id,
      this.acceptedSuggestion() ? {
        reference: this.acceptedSuggestion()!.acceptanceReference,
        originalText: this.acceptedSuggestion()!.originalText ?? name,
        replacement: this.acceptedSuggestion()!.replacement,
        ...(this.acceptedSuggestion()!.productId ? { productId: this.acceptedSuggestion()!.productId } : {}),
        ...(this.acceptedSuggestion()!.conceptId ? { conceptId: this.acceptedSuggestion()!.conceptId } : {}),
        ...(this.acceptedSuggestion()!.brandId ? { brandId: this.acceptedSuggestion()!.brandId } : {}),
      } : undefined,
    ).subscribe({
      next: (result) => {
        this.conversationResult.set(result);
        for (const item of [...result.saved, ...result.merged]) this.observeAuthoritativeSpelling(item.name);
        this.itemName.set('');
        this.captureConfirmedUnit.set(null);
        this.acceptedProduct.set(null);
        this.acceptedSuggestion.set(null);
        this.captureErrorMessage.set('');
        this.message.set('');
        this.addPending.set(false);
        this.loadItems();
      },
      error: (error: HttpErrorResponse) => {
        if (error.status === 401) {
          this.pairingRequired.set(true);
          this.message.set('Connect this device to the household before retrying.');
        } else {
          this.message.set(error.status === 409
            ? 'That item could not be merged safely.'
            : 'Could not process that capture. Your text is still here to retry.');
        }
        this.addPending.set(false);
      },
    });
  }

  private restoreConversationState(): void {
    this.conversationContext.initialize(this.householdId, this.contextDeviceId).subscribe({
      next: (registration) => this.shoppingItems.listLists(this.householdId).subscribe({
        next: (lists) => {
          const list = lists.find((candidate) => candidate.isDefault) ?? lists[0];
          if (!list) return;
          this.conversationLifecycle.hydrateWithRecovery(
            this.householdId,
            list.id,
            registration,
            () => {
              this.conversationContext.clear();
              return this.conversationContext.register(this.householdId, this.contextDeviceId);
            },
          ).subscribe({
            next: () => this.conversationLifecycle.evaluateIdle(this.householdId, list.id, registration).subscribe({
              next: ({ session, pendingAction }) => {
                if (!session) return;
                this.conversationResult.update((current) => current ? {
                  ...current,
                  session,
                  pendingAction,
                } : current);
              },
              error: () => undefined,
            }),
            error: () => undefined,
          });
        },
      }),
    });
  }

  private addLegacyItem(name: string): void {
    if (!this.capturePreview()) {
      this.captureErrorMessage.set('Add an item name after the quantity.');
      return;
    }
    this.addPending.set(true);
    this.message.set('');
    this.shoppingItems.add(
      this.householdId,
      name,
      this.captureConfirmedUnit() ?? undefined,
      this.acceptedProduct()?.productId,
    ).subscribe({
      next: (item) => {
        this.items.update((items) => items.some((candidate) => candidate.id === item.id) ? items : [...items, item]);
        this.rememberExplicitUnit(item);
        this.refreshAssistanceItem(item);
        this.observeAuthoritativeSpelling(item.name);
        this.itemName.set('');
        this.captureConfirmedUnit.set(null);
        this.acceptedProduct.set(null);
        this.captureErrorMessage.set('');
        this.message.set(`${item.name} added to the list.`);
        this.addPending.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.message.set(error.status === 409 ? 'That item is already on the list.' : 'Could not add that item.');
        this.addPending.set(false);
      },
    });
  }

  protected beginDraftReview(draft: ClarificationDraft): void {
    this.reviewingDraftId.set(draft.id);
    this.draftResolutionText.set(draft.text === '???' ? '' : draft.text);
  }

  protected cancelDraftReview(): void {
    this.reviewingDraftId.set(null);
    this.draftResolutionText.set('');
  }

  protected resolveDraft(draft: ClarificationDraft): void {
    const text = this.draftResolutionText().trim();
    if (!text || this.addPending()) return;
    this.addPending.set(true);
    this.conversation.resolveDraft(this.householdId, draft.id, text).subscribe({
      next: ({ draft: resolved, result }) => {
        this.conversationResult.update((current) => current ? {
          ...current,
          session: result.session,
          saved: [...current.saved, ...result.saved],
          merged: [...current.merged, ...result.merged],
          undo: [...current.undo, ...result.undo],
          drafts: current.drafts.map((candidate) => candidate.id === resolved.id ? resolved : candidate),
        } : result);
        this.cancelDraftReview();
        this.addPending.set(false);
        this.loadItems();
      },
      error: () => {
        this.message.set('That clarification still needs more detail.');
        this.addPending.set(false);
      },
    });
  }

  protected dismissDraft(draft: ClarificationDraft): void {
    this.conversation.dismissDraft(this.householdId, draft.id).subscribe({
      next: (dismissed) => this.conversationResult.update((current) => current ? {
        ...current,
        drafts: current.drafts.map((candidate) => candidate.id === dismissed.id ? dismissed : candidate),
      } : current),
      error: () => this.message.set('Could not dismiss that clarification yet.'),
    });
  }

  protected undoConversationAdjustment(token: UndoToken): void {
    if (this.isItemPending(token.itemId)) return;
    this.setItemPending(token.itemId, true);
    this.conversation.undo(this.householdId, token.eventId).subscribe({
      next: ({ item }) => {
        this.replaceItem(item);
        this.conversationResult.update((current) => current ? {
          ...current,
          undo: current.undo.filter((candidate) => candidate.eventId !== token.eventId),
        } : current);
        this.message.set(`Restored the previous quantity for ${item.name}.`);
        this.setItemPending(token.itemId, false);
      },
      error: () => {
        this.message.set('Could not undo that adjustment.');
        this.setItemPending(token.itemId, false);
      },
    });
  }

  protected confirmConversationClose(pendingAction: NonNullable<ConversationCaptureResult['pendingAction']>): void {
    const registration = this.currentContext();
    const shoppingListId = this.conversationState()?.list.id;
    if (!registration || !shoppingListId || this.addPending()) return;
    this.addPending.set(true);
    this.conversation.confirmClose(this.householdId, pendingAction.id, registration, shoppingListId).subscribe({
      next: ({ session, pendingAction: resolved }) => {
        this.conversationResult.update((current) => current ? {
          ...current,
          session,
          pendingAction: resolved,
        } : current);
        this.addPending.set(false);
        this.message.set('Conversation closed. Your shopping list remains active.');
      },
      error: () => {
        this.addPending.set(false);
        this.message.set('The close request expired. Keep adding items or try again.');
      },
    });
  }

  protected cancelConversationClose(pendingAction: NonNullable<ConversationCaptureResult['pendingAction']>): void {
    const registration = this.currentContext();
    const shoppingListId = this.conversationState()?.list.id;
    if (!registration || !shoppingListId || this.addPending()) return;
    this.addPending.set(true);
    this.conversation.cancelClose(this.householdId, pendingAction.id, registration, shoppingListId).subscribe({
      next: ({ session, pendingAction: resolved }) => {
        this.conversationResult.update((current) => current ? {
          ...current,
          session,
          pendingAction: resolved,
        } : current);
        this.addPending.set(false);
        this.message.set('Conversation stays open. You can keep adding items.');
      },
      error: () => {
        this.addPending.set(false);
        this.message.set('Could not keep the conversation open yet.');
      },
    });
  }

  protected beginArchive(): void {
    if (this.activeCount() === 0 || this.archivePending()) return;
    this.archiveConfirming.set(true);
  }

  protected cancelArchive(): void {
    this.archiveConfirming.set(false);
  }

  protected confirmArchive(): void {
    if (!this.archiveConfirming() || this.archivePending()) return;
    this.archivePending.set(true);
    this.shoppingItems.archiveList(this.householdId).subscribe({
      next: (archive) => {
        this.listArchives.update((archives) => [
          archive,
          ...archives.filter((candidate) => candidate.id !== archive.id),
        ]);
        this.archiveHistoryOpen.set(true);
        this.archiveConfirming.set(false);
        this.archivePending.set(false);
        this.message.set('List snapshot archived. Your active items are unchanged.');
      },
      error: () => {
        this.archivePending.set(false);
        this.message.set('Could not archive this list yet.');
      },
    });
  }

  protected toggleArchiveHistory(): void {
    if (this.archiveHistoryOpen()) {
      this.archiveHistoryOpen.set(false);
      return;
    }
    this.archiveHistoryOpen.set(true);
    if (this.archiveHistoryLoaded()) return;
    this.shoppingItems.listArchives(this.householdId).subscribe({
      next: (archives) => {
        this.listArchives.set(archives);
        this.archiveHistoryLoaded.set(true);
      },
      error: () => this.message.set('Could not load archived lists.'),
    });
  }

  protected reopenArchive(archive: ShoppingListArchive): void {
    if (this.archivePending()) return;
    this.archivePending.set(true);
    this.shoppingItems.reopenArchive(this.householdId, archive.id).subscribe({
      next: (reopened) => {
        this.listArchives.update((archives) => archives.map((candidate) => (
          candidate.id === reopened.id ? reopened : candidate
        )));
        this.archivePending.set(false);
        this.message.set('Archived list reopened for review. Your active list is unchanged.');
      },
      error: () => {
        this.archivePending.set(false);
        this.message.set('Could not reopen that archive.');
      },
    });
  }

  protected copyArchive(archive: ShoppingListArchive): void {
    if (this.archivePending()) return;
    this.archivePending.set(true);
    this.shoppingItems.copyArchive(this.householdId, archive.id).subscribe({
      next: () => {
        this.archivePending.set(false);
        this.message.set('Archived items copied into the active list.');
        this.loadItems();
      },
      error: () => {
        this.archivePending.set(false);
        this.message.set('Could not copy that archived list.');
      },
    });
  }

  protected updateItemName(value: string): void {
    this.itemName.set(value);
    this.cloudSuggestion.set(null);
    this.cloudAssistRequestVersion += 1;
    const accepted = this.acceptedProduct();
    const acceptedSuggestion = this.acceptedSuggestion();
    if (accepted) {
      const valueKey = normalizeUiKey(value);
      const productKey = normalizeUiKey(accepted.text);
      if (valueKey !== productKey && !valueKey.startsWith(`${productKey} `)) this.acceptedProduct.set(null);
    }
    this.captureConfirmedUnit.set(null);
    if (acceptedSuggestion) {
      const expected = acceptedSuggestion.protectedPrefix
        + acceptedSuggestion.replacement.replacementText
        + acceptedSuggestion.protectedSuffix;
      if (normalizeUiKey(value) !== normalizeUiKey(expected)) this.acceptedSuggestion.set(null);
    }
    this.captureErrorMessage.set('');
    if (this.cloudAssistTypingTimer) clearTimeout(this.cloudAssistTypingTimer);
    const localResolution = this.captureAssistance.resolveLocalCapture(value);
    if (value.trim().length >= 4 && !this.acceptedSuggestion() && localResolution.status !== 'resolved') {
      this.cloudAssistTypingTimer = setTimeout(() => this.requestCloudAssist(value.trim(), 'typing'), 550);
    }
  }

  protected useCloudSuggestion(): void {
    const candidate = this.cloudSuggestion();
    if (!candidate) return;
    this.cloudLookupPending.set(true);
    this.cloudAssist.accept(this.householdId, candidate.acceptanceToken, this.itemName()).subscribe({
      next: ({ suggestion }) => {
        this.itemName.set(this.cloudSuggestionText(suggestion));
        this.cloudSuggestion.set(null);
        this.cloudLookupPending.set(false);
        this.captureErrorMessage.set('Review the optional details, then select Add to confirm the item.');
      },
      error: () => {
        this.cloudLookupPending.set(false);
        this.cloudSuggestion.set(null);
        this.captureErrorMessage.set('That suggestion is no longer current. Your item text was not changed.');
      },
    });
  }

  protected requestOptionalDetails(): void {
    const text = this.itemName().trim();
    if (text.length < 4 || this.cloudLookupPending()) return;
    this.requestCloudAssist(text, 'save', true);
  }

  private requestCloudAssist(text: string, trigger: 'save' | 'typing', explicitRequest = false): void {
    const requestVersion = this.cloudAssistRequestVersion;
    const useSettings = (settings: HouseholdCaptureSettings) => {
      if (requestVersion !== this.cloudAssistRequestVersion) return;
      const enabled = settings.entitlement === 'premium'
        && settings.onlineLookupConsent === true
        && (trigger === 'save' ? settings.cloudAssistOnSave : settings.cloudAssistWhileTyping);
      if (!enabled) {
        if (explicitRequest) this.captureErrorMessage.set('Premium online lookup is off. You can enable it in Conversation settings.');
        return;
      }
      this.cloudLookupPending.set(true);
      this.cloudAssist.suggest(this.householdId, text, trigger === 'save' ? 'manual' : 'on_idle', requestVersion).subscribe({
        next: (result) => {
          if (requestVersion === this.cloudAssistRequestVersion && result.suggestion && result.acceptanceToken && result.source && result.expiresAt) {
            this.cloudSuggestion.set({ suggestion: result.suggestion, acceptanceToken: result.acceptanceToken, source: result.source, expiresAt: result.expiresAt });
          }
          if (requestVersion === this.cloudAssistRequestVersion) this.cloudLookupPending.set(false);
        },
        error: () => { if (requestVersion === this.cloudAssistRequestVersion) this.cloudLookupPending.set(false); },
      });
    };
    const cached = this.householdSettings.cached(this.householdId);
    if (cached) {
      useSettings(cached);
      return;
    }
    if (!explicitRequest && !this.householdSettings.mayUseCloudAssist(this.householdId)) return;
    this.householdSettings.get(this.householdId).subscribe({
      next: useSettings,
      error: () => undefined,
    });
  }

  protected cloudSuggestionText(suggestion: CloudAssistSuggestion): string {
    const request = [suggestion.quantity, suggestion.unit].filter((part): part is string | number => part !== null).join(' ');
    const measures = suggestion.measures.map((measure) => `${measure.value} ${measure.unit}`).join(' ');
    return [request, suggestion.itemName, measures].filter(Boolean).join(' ').trim();
  }

  protected acceptCaptureSuggestion(suggestion: CaptureSuggestion): void {
    if ('acceptanceReference' in suggestion) this.acceptedSuggestion.set(suggestion as SemanticSuggestion);
    this.acceptedProduct.set(suggestion.productId
      ? { productId: suggestion.productId, text: suggestion.text }
      : null);
  }

  protected changeSort(mode: ShoppingItemSort): void {
    this.sortMode.set(mode);
    this.listPreferences.writeSort(this.householdId, mode);
  }

  protected pairSession(): void {
    const code = this.pairingCode().trim();
    if (!code || this.pairingPending()) return;
    this.pairingPending.set(true);
    this.session.pair(code).subscribe({
      next: () => {
        this.pairingRequired.set(false);
        this.pairingCode.set('');
        this.pairingPending.set(false);
        this.message.set('Household session connected.');
        this.loadItems();
        this.restoreConversationState();
      },
      error: () => {
        this.pairingPending.set(false);
        this.message.set('That pairing code was not accepted.');
      },
    });
  }

  protected selectShopType(shopTypeId: string | null): void {
    this.selectedShopTypeId.set(shopTypeId);
  }

  protected isShopTypeApplied(item: ShoppingItem, shopTypeId: string): boolean {
    return item.shopTypes?.some((shopType) => shopType.id === shopTypeId) ?? false;
  }

  protected beginShopTypeEditing(item: ShoppingItem): void {
    this.shopTypeEditingItemId.set(item.id);
    this.shoppingItems.view(this.householdId).subscribe({
      next: (view) => this.availableShopTypes.set(view.facets.filter((facet) => facet.id !== 'unassigned')),
      error: () => this.setRowMessage(item.id, 'Could not load shop types.'),
    });
  }

  protected changeShopType(item: ShoppingItem, shopTypeId: string, include: boolean): void {
    if (this.isItemPending(item.id)) return;
    this.setItemPending(item.id, true);
    this.shoppingItems.updateClassification(this.householdId, item.id, {
      expectedVersion: item.version,
      shopTypeDecisions: [{ tagId: shopTypeId, decision: include ? 'include' : 'exclude' }],
    }).subscribe({
      next: (updated) => {
        this.replaceItem(updated);
        this.setItemPending(item.id, false);
      },
      error: (error: HttpErrorResponse) => {
        this.handleUpdateError(error, item);
        this.setItemPending(item.id, false);
      },
    });
  }

  protected applyLanguageSettings(change: LanguageSettingsChange): void {
    this.activeLocale.set(change.preferences.activeLocale);
    this.enabledLocales.set([...change.preferences.enabledLocales]);
    if (change.bundle) {
      this.activeLanguageBundle.set(change.bundle);
      this.installedLanguageBundles.update((bundles) => [
        ...bundles.filter((bundle) => bundle.locale !== change.bundle!.locale),
        change.bundle!,
      ]);
    }
    if (change.regionalProducts) this.regionalProducts.set(change.regionalProducts);
    this.configureAssistance();
  }

  protected uiText(key: string, fallback: string): string {
    return this.activeLanguageBundle()?.ui[key] ?? fallback;
  }

  protected formatBrandName(brandName: string | null | undefined): string {
    return formatBrandName(brandName);
  }

  protected classificationHint(item: ShoppingItem): string {
    const key = classificationHintKey(item);
    return key ? this.uiText(key, '') : '';
  }

  protected helpfulDetailHint(item: ShoppingItem): string {
    if (!item.categoryId || item.categoryId === 'unknown') return '';
    return this.uiText(`capture.helpful.${item.categoryId}`, '');
  }

  protected semanticDetails(item: ShoppingItem): string[] {
    return Object.entries(item.attributes ?? {})
      .flatMap(([key, value]) => {
        if (
          key === 'measure:net_content'
          && item.packageSize !== null
          && typeof item.packageUnit === 'string'
          && item.packageUnit.trim().length > 0
        ) return [];
        if (typeof value !== 'string' || !value.trim()) return [];
        const label = this.uiText(`detail.${item.categoryId ?? 'unknown'}.attribute.${key}.label`,
          this.uiText(`detail.attribute.${key}.label`, key === 'strength'
            ? 'strength'
            : key.startsWith('measure:') && key !== 'measure:medicine_strength'
              ? key.slice('measure:'.length).replaceAll('_', ' ')
              : ''));
        return label ? [`${value} ${label}`] : [];
      });
  }

  protected detailFields(item: ShoppingItem): readonly ('quantity' | 'unit' | 'packageSize' | 'packageUnit')[] {
    const category = item.categoryId ?? 'unknown';
    const configured = this.uiText(`detail.${category}.fields`, this.uiText('detail.unknown.fields', 'quantity,unit,packageSize,packageUnit'))
      .split(',')
      .map((field) => field.trim())
      .filter((field): field is 'quantity' | 'unit' | 'packageSize' | 'packageUnit' =>
        field === 'quantity' || field === 'unit' || field === 'packageSize' || field === 'packageUnit');
    return configured.length > 0 ? configured : ['quantity', 'unit', 'packageSize', 'packageUnit'];
  }

  protected detailFieldLabel(item: ShoppingItem, field: 'quantity' | 'unit' | 'packageSize' | 'packageUnit'): string {
    const category = item.categoryId ?? 'unknown';
    const fallback = {
      quantity: 'Quantity', unit: 'Unit', packageSize: 'Package size', packageUnit: 'Package unit',
    }[field];
    return this.uiText(`detail.${category}.${field}.label`, this.uiText(`detail.${field}.label`, fallback));
  }

  protected detailFieldHelp(field: 'quantity' | 'unit' | 'packageSize' | 'packageUnit'): string {
    return this.uiText(`detail.${field}.help`, 'optional');
  }

  protected formatItemName(itemName: string, brandName?: string | null): string {
    return formatItemName(itemName, brandName);
  }

  protected formatMeasurement(quantity: number, unit: string | null | undefined): string {
    return formatMeasurement(quantity, unit);
  }

  protected formatUnitLabel(unit: string | null | undefined): string {
    return formatUnitLabel(unit);
  }

  protected measurementAriaLabel(quantity: number, unit: string | null | undefined): string {
    return measurementAriaLabel(quantity, unit);
  }

  protected unitAriaLabel(unit: string | null | undefined): string {
    return unitAriaLabel(unit);
  }

  private getOrCreateContextDeviceId(): string {
    const key = 'duckworth.context-device-id';
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const cryptoApi = globalThis.crypto;
    if (cryptoApi?.randomUUID) {
      const id = cryptoApi.randomUUID();
      localStorage.setItem(key, id);
      return id;
    }
    const bytes = new Uint8Array(12);
    cryptoApi?.getRandomValues?.(bytes);
    const id = `device-${Date.now()}-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    localStorage.setItem(key, id);
    return id;
  }

  protected acceptCaptureUnit(): void {
    const preview = this.capturePreview();
    if (preview?.unitSource === 'history' && preview.unit) this.captureConfirmedUnit.set(preview.unit);
  }

  protected togglePurchased(item: ShoppingItem): void {
    if (this.isItemPending(item.id)) return;
    this.setItemPending(item.id, true);
    const status = item.status === 'purchased' ? 'active' : 'purchased';
    this.shoppingItems.update(this.householdId, item.id, { status, expectedVersion: item.version }).subscribe({
      next: (updated) => {
        this.replaceItem(updated);
        this.message.set(`${updated.name} ${status === 'purchased' ? 'marked purchased' : 'reopened'}.`);
        this.setItemPending(item.id, false);
      },
      error: (error: HttpErrorResponse) => {
        this.handleUpdateError(error, item);
        this.setItemPending(item.id, false);
      },
    });
  }

  protected beginEdit(item: ShoppingItem): void {
    this.beginDetails(item);
  }

  protected removeItem(item: ShoppingItem): void {
    if (item.status !== 'active' || this.isItemPending(item.id)) return;
    this.setItemPending(item.id, true);
    this.shoppingItems.update(this.householdId, item.id, {
      status: 'removed',
      expectedVersion: item.version,
    }).subscribe({
      next: (updated) => {
        this.replaceItem(updated);
        this.lastRemovedItem.set(updated);
        this.message.set(`${updated.name} removed from the list.`);
        this.setItemPending(item.id, false);
      },
      error: (error: HttpErrorResponse) => {
        this.handleUpdateError(error, item);
        this.setItemPending(item.id, false);
      },
    });
  }

  protected undoRemoval(): void {
    const item = this.lastRemovedItem();
    if (item) this.restoreItem(item);
  }

  protected restoreItem(item: ShoppingItem): void {
    if (!item || this.isItemPending(item.id)) return;
    this.setItemPending(item.id, true);
    this.shoppingItems.update(this.householdId, item.id, {
      status: 'active',
      expectedVersion: item.version,
    }).subscribe({
      next: (updated) => {
        this.replaceItem(updated);
        if (this.lastRemovedItem()?.id === item.id) this.lastRemovedItem.set(null);
        this.message.set(`${updated.name} restored to the list.`);
        this.setItemPending(item.id, false);
      },
      error: (error: HttpErrorResponse) => {
        this.handleUpdateError(error, item);
        this.setItemPending(item.id, false);
      },
    });
  }

  protected beginDetails(item: ShoppingItem): void {
    this.detailsEditingId.set(item.id);
    this.detailsNameDraft.set(item.name);
    this.detailsQuantityDraft.set(item.quantity?.toString() ?? '');
    this.detailsUnitDraft.set(formatUnitLabel(item.unit));
    this.detailsPackageSizeDraft.set(item.packageSize?.toString() ?? '');
    this.detailsPackageUnitDraft.set(formatUnitLabel(item.packageUnit));
    this.detailsLearnCorrection.set(false);
    this.detailsOriginalUnit.set(item.unit);
    this.clearRowMessage(item.id);
  }

  protected cancelDetails(): void {
    this.detailsEditingId.set(null);
    this.detailsNameDraft.set('');
    this.detailsQuantityDraft.set('');
    this.detailsUnitDraft.set('');
    this.detailsPackageSizeDraft.set('');
    this.detailsPackageUnitDraft.set('');
    this.detailsLearnCorrection.set(false);
    this.detailsOriginalUnit.set(null);
  }

  protected saveDetails(item: ShoppingItem): void {
    const name = this.detailsNameDraft().trim();
    if (!name) {
      this.setRowMessage(item.id, 'Enter an item name before saving.');
      return;
    }
    const quantityText = this.detailsQuantityDraft().trim();
    const quantity = quantityText ? Number(quantityText) : null;
    if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0)) {
      this.setRowMessage(item.id, 'Enter a quantity greater than zero.');
      return;
    }
    const unit = this.detailsUnitDraft().trim();
    if (unit.length > 32) {
      this.setRowMessage(item.id, 'Keep the unit to 32 characters or fewer.');
      return;
    }
    const packageSizeText = this.detailsPackageSizeDraft().trim();
    const packageUnit = this.detailsPackageUnitDraft().trim();
    const packageSize = packageSizeText ? Number(packageSizeText) : null;
    if ((packageSize === null) !== (packageUnit.length === 0)) {
      this.setRowMessage(item.id, 'Enter both package size and package unit, or leave both empty.');
      return;
    }
    if (packageSize !== null && (!Number.isFinite(packageSize) || packageSize <= 0)) {
      this.setRowMessage(item.id, 'Enter a package size greater than zero.');
      return;
    }
    if (packageUnit.length > 32) {
      this.setRowMessage(item.id, 'Keep the package unit to 32 characters or fewer.');
      return;
    }
    this.setItemPending(item.id, true);
    if (this.detailsLearnCorrection()) {
      const rawClause = item.captureText;
      this.shoppingItems.semanticCorrection(this.householdId, item.id, {
        schemaVersion: 1,
        idempotencyKey: `ui-correction:${item.id}:${item.version}:${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
        itemId: item.id,
        expectedItemVersion: item.version,
        source: {
          captureInputId: item.id,
          operationIndex: 0,
          sourceStart: 0,
          sourceEnd: rawClause.length,
          rawClause,
        },
        corrected: {
          canonicalLabel: name,
          quantity,
          unitId: unit || null,
          packageSize,
          packageUnitId: packageUnit || null,
        },
        learn: { mode: 'future_matching_items', scope: 'household' },
      }).subscribe({
        next: ({ item: updated }) => {
          const confirmed = { ...updated, semanticLearningStatus: 'confirmed' as const };
          this.replaceItem(confirmed);
          this.cancelDetails();
          this.message.set(`${confirmed.name} details saved and remembered for matching items.`);
          this.setItemPending(item.id, false);
        },
        error: (error: HttpErrorResponse) => {
          this.handleUpdateError(error, item);
          this.setItemPending(item.id, false);
        },
      });
      return;
    }
    this.shoppingItems.update(this.householdId, item.id, {
      captureText: name,
      name,
      quantity,
      confirmedUnit: unit || null,
      packageSize,
      packageUnit: packageUnit || null,
      expectedVersion: item.version,
    }).subscribe({
      next: (updated) => {
        this.replaceItem(updated);
        this.cancelDetails();
        this.message.set(`${updated.name} details saved.`);
        this.setItemPending(item.id, false);
      },
      error: (error: HttpErrorResponse) => {
        this.handleUpdateError(error, item);
        this.setItemPending(item.id, false);
      },
    });
  }

  protected isItemPending(itemId: string): boolean {
    return this.pendingItemIds().has(itemId);
  }

  protected acceptHistoricalUnit(item: ShoppingItem): void {
    if (!item.unit || this.isItemPending(item.id)) return;
    this.setItemPending(item.id, true);
    this.clearRowMessage(item.id);
    this.shoppingItems.update(this.householdId, item.id, {
      confirmedUnit: item.unit,
      expectedVersion: item.version,
    }).subscribe({
      next: (updated) => {
        this.replaceItem(updated);
        this.message.set(`${updated.unit} accepted for ${updated.name}.`);
        this.setItemPending(item.id, false);
      },
      error: (error: HttpErrorResponse) => {
        this.handleUpdateError(error, item);
        this.setItemPending(item.id, false);
      },
    });
  }

  protected hasAttention(item: ShoppingItem, reason: ShoppingItem['attentionReasons'][number]): boolean {
    return item.attentionReasons.includes(reason);
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.editDraft.set('');
  }

  protected saveEdit(item: ShoppingItem): void {
    const name = this.editDraft().trim();
    if (!name) {
      this.setRowMessage(item.id, 'Enter an item name before saving.');
      return;
    }
    if (this.isItemPending(item.id)) return;
    this.setItemPending(item.id, true);
    this.shoppingItems.update(this.householdId, item.id, { name, expectedVersion: item.version }).subscribe({
      next: (updated) => {
        this.replaceItem(updated);
        this.observeAuthoritativeSpelling(updated.name);
        this.cancelEdit();
        this.message.set(`${updated.name} updated.`);
        this.setItemPending(item.id, false);
      },
      error: (error: HttpErrorResponse) => {
        this.handleUpdateError(error, item);
        this.setItemPending(item.id, false);
      },
    });
  }

  private loadItems(): void {
    this.shoppingItems.list(this.householdId, true, true).subscribe({
      next: (items) => {
        this.items.set(items);
        this.unitHistory.set(this.unitHistoryCache.replaceFromItems(this.householdId, items));
        this.householdVocabulary.replace(items);
        this.configureAssistance();
      },
      error: (error: HttpErrorResponse) => {
        if (error.status === 401) this.pairingRequired.set(true);
        this.message.set(error.status === 401
          ? 'Connect this device to the household to view the list.'
          : 'Could not load the shopping list.');
      },
    });
  }

  protected clearLearning(entry: LearnedSemanticEntry): void {
    this.householdLearning.setLearnedStatus(this.householdId, entry.id, 'cleared').subscribe({ next: (updated) => this.learnedEntries.update((entries) => entries.map((candidate) => candidate.id === updated.id ? updated : candidate)) });
  }

  protected restoreLearning(entry: LearnedSemanticEntry): void {
    this.householdLearning.setLearnedStatus(this.householdId, entry.id, 'active').subscribe({ next: (updated) => this.learnedEntries.update((entries) => entries.map((candidate) => candidate.id === updated.id ? updated : candidate)) });
  }

  protected loadLearning(): void {
    this.householdLearning.control(this.householdId).subscribe({
      next: (control) => {
        this.learnedEntries.set(control.entries);
        this.learningCorrections.set(control.corrections);
        this.learningMetrics.set(control.metrics);
      },
      error: () => this.householdLearning.learned(this.householdId).subscribe({ next: (entries) => this.learnedEntries.set(entries) }),
    });
  }

  protected undoCorrection(event: SemanticCorrectionRecord): void {
    this.householdLearning.undoCorrection(this.householdId, event.id).subscribe({
      next: () => {
        this.message.set('The correction was undone; its future influence is suppressed.');
        this.loadLearning();
        this.loadItems();
      },
    });
  }

  protected clearPersonalVocabulary(): void {
    const snapshot = this.personalVocabulary!.clear();
    this.personalVocabularyEnabled.set(snapshot.enabled ?? true);
    this.configureAssistance();
    this.message.set('This device spelling history was cleared.');
  }

  protected togglePersonalVocabulary(): void {
    const snapshot = this.personalVocabulary!.setEnabled(!this.personalVocabularyEnabled());
    this.personalVocabularyEnabled.set(snapshot.enabled ?? true);
    this.configureAssistance();
    this.message.set(snapshot.enabled ? 'This device spelling help is enabled.' : 'This device spelling help is disabled.');
  }

  protected exportCaptureHistory(): void {
    this.conversation.exportCaptureHistory(this.householdId).subscribe({
      next: (exported) => {
        const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
        const url = globalThis.URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `duckworth-capture-audit-${new Date().toISOString().slice(0, 10)}.json`;
        anchor.click();
        globalThis.URL.revokeObjectURL(url);
        this.capturePrivacyMessage.set(`Exported ${exported.captures.length} capture records. They expire after ${exported.retention.days} days.`);
      },
      error: () => this.capturePrivacyMessage.set('Capture history export could not be completed.'),
    });
  }

  protected deleteCaptureHistory(): void {
    this.conversation.deleteCaptureHistory(this.householdId).subscribe({
      next: ({ deleted }) => this.capturePrivacyMessage.set(`Deleted ${deleted} raw capture records. Shopping-list items remain unchanged.`),
      error: () => this.capturePrivacyMessage.set('Capture history could not be deleted.'),
    });
  }

  private replaceItem(updated: ShoppingItem): void {
    this.items.update((items) => items.map((item) => item.id === updated.id ? updated : item));
    this.rememberExplicitUnit(updated);
    this.refreshAssistanceItem(updated);
  }

  private rememberExplicitUnit(item: ShoppingItem): void {
    this.unitHistory.set(this.unitHistoryCache.mergeExplicitItem(this.householdId, item));
  }

  protected resolveSpelling(decision: SpellingDecision): void {
    const candidate = this.clarificationCandidate();
    if (!candidate) return;
    this.captureAssistance.resolveClarification(candidate, decision, this.personalVocabulary!);
    this.clarificationCandidate.set(null);
  }

  private configureAssistance(): void {
    if (!this.personalVocabulary) return;
    const personal = this.personalVocabulary.assistanceSnapshot();
    this.personalVocabularyEnabled.set(personal.enabled ?? true);
    this.captureAssistance.configure({
      activeLocale: this.activeLocale(),
      enabledLocales: this.enabledLocales(),
      packs: this.installedLanguageBundles(),
      regionalProducts: this.regionalProducts(),
      household: this.householdVocabulary.snapshot(),
      personal,
    });
  }

  private refreshAssistanceItem(item: ShoppingItem): void {
    this.householdVocabulary.merge(item);
    this.configureAssistance();
  }

  private observeAuthoritativeSpelling(text: string): void {
    const candidate = this.captureAssistance.observeSuccessfulCapture(text, this.personalVocabulary!);
    if (candidate) this.clarificationCandidate.set(candidate);
  }

  protected rowMessageFor(itemId: string): string | undefined {
    return this.rowMessages()[itemId];
  }

  private handleUpdateError(error: HttpErrorResponse, item: ShoppingItem): void {
    if (error.status === 409 && error.error?.error === 'duplicate_item') {
      this.setRowMessage(item.id, 'That name is already on the list. Choose a different name.');
      return;
    }
    if (error.status === 409 && error.error?.currentItem) {
      this.replaceItem(error.error.currentItem as ShoppingItem);
      this.setRowMessage(item.id, 'This item changed in another tab. The latest version is shown; review your change and try again.');
      return;
    }
    if (error.status === 400) {
      this.setRowMessage(item.id, 'That item change was not valid. Check the name and try again.');
      return;
    }
    if (error.status === 404) {
      this.setRowMessage(item.id, 'This item is no longer available. Refresh the list to continue.');
      return;
    }
    this.setRowMessage(item.id, `We couldn't save “${item.name}”. Check your connection and try again.`);
  }

  private setRowMessage(itemId: string, message: string): void {
    this.rowMessages.update((messages) => ({ ...messages, [itemId]: message }));
  }

  private clearRowMessage(itemId: string): void {
    this.rowMessages.update((messages) => {
      const next = { ...messages };
      delete next[itemId];
      return next;
    });
  }

  private setItemPending(itemId: string, pending: boolean): void {
    this.pendingItemIds.update((ids) => {
      const next = new Set(ids);
      if (pending) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  }
}

function normalizeUiKey(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
}

function hasInlineQuantity(value: string): boolean {
  const normalized = value.trim().toLocaleLowerCase();
  return /(?:^|\s)\d+(?:\.\d+)?\s*[\p{L}%]+(?:\s|$)/u.test(normalized)
    || /(?:^|\s)(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|quarter|half|couple|few|several)\s+[\p{L}]+/u.test(normalized);
}

function runtimeTitle(lane: RuntimeLane): string {
  if (lane === 'live') return 'Duckworth · Household list';
  if (lane === 'sandbox') return 'TESTING · Duckworth';
  return 'DISPOSABLE API TEST · Duckworth';
}
