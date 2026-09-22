import CoreData

struct PersistenceController {
    let container: NSPersistentContainer

    init(inMemory: Bool = false) {
        let model = Self.makeModel()
        container = NSPersistentContainer(name: "FinancialTracking", managedObjectModel: model)
        if inMemory {
            container.persistentStoreDescriptions.first?.url = URL(fileURLWithPath: "/dev/null")
        }
        container.loadPersistentStores { _, error in
            if let error {
                preconditionFailure("Unable to load persistent store: \(error.localizedDescription)")
            }
        }
        container.viewContext.automaticallyMergesChangesFromParent = true
        container.viewContext.mergePolicy = NSMergeByPropertyObjectTrumpMergePolicy
    }

    static func makeModel() -> NSManagedObjectModel {
        let model = NSManagedObjectModel()
        model.entities = [
            entity("RecurringBill", fields: [
                attribute("id", .UUIDAttributeType, optional: false), attribute("ownerID", .UUIDAttributeType, optional: false),
                attribute("name", .stringAttributeType), attribute("category", .stringAttributeType),
                attribute("amountMinorUnits", .integer64AttributeType), attribute("currencyCode", .stringAttributeType),
                attribute("dueDay", .integer16AttributeType), attribute("active", .booleanAttributeType),
                attribute("validFrom", .dateAttributeType), attribute("validTo", .dateAttributeType, optional: true),
                attribute("currentFlag", .booleanAttributeType)
            ]),
            entity("BillOccurrence", fields: [
                attribute("id", .UUIDAttributeType, optional: false), attribute("billID", .UUIDAttributeType, optional: false),
                attribute("ownerID", .UUIDAttributeType, optional: false), attribute("dueDate", .dateAttributeType),
                attribute("amountMinorUnits", .integer64AttributeType), attribute("currencyCode", .stringAttributeType),
                attribute("status", .stringAttributeType)
            ]),
            entity("FinancialAccount", fields: [
                attribute("id", .UUIDAttributeType, optional: false), attribute("ownerID", .UUIDAttributeType, optional: false),
                attribute("name", .stringAttributeType), attribute("institution", .stringAttributeType),
                attribute("accountType", .stringAttributeType), attribute("validFrom", .dateAttributeType),
                attribute("validTo", .dateAttributeType, optional: true), attribute("currentFlag", .booleanAttributeType)
            ]),
            entity("BalanceSnapshot", fields: [
                attribute("id", .UUIDAttributeType, optional: false), attribute("ownerID", .UUIDAttributeType, optional: false),
                attribute("accountID", .UUIDAttributeType, optional: false), attribute("date", .dateAttributeType),
                attribute("amountMinorUnits", .integer64AttributeType), attribute("currencyCode", .stringAttributeType)
            ]),
            entity("Asset", fields: [
                attribute("id", .UUIDAttributeType, optional: false), attribute("ownerID", .UUIDAttributeType, optional: false),
                attribute("name", .stringAttributeType), attribute("category", .stringAttributeType),
                attribute("amountMinorUnits", .integer64AttributeType), attribute("currencyCode", .stringAttributeType),
                attribute("validFrom", .dateAttributeType), attribute("validTo", .dateAttributeType, optional: true),
                attribute("currentFlag", .booleanAttributeType)
            ]),
            entity("Liability", fields: [
                attribute("id", .UUIDAttributeType, optional: false), attribute("ownerID", .UUIDAttributeType, optional: false),
                attribute("name", .stringAttributeType), attribute("category", .stringAttributeType),
                attribute("amountMinorUnits", .integer64AttributeType), attribute("currencyCode", .stringAttributeType),
                attribute("validFrom", .dateAttributeType), attribute("validTo", .dateAttributeType, optional: true),
                attribute("currentFlag", .booleanAttributeType)
            ]),
            entity("Holding", fields: [
                attribute("id", .UUIDAttributeType, optional: false), attribute("ownerID", .UUIDAttributeType, optional: false),
                attribute("symbol", .stringAttributeType), attribute("assetType", .stringAttributeType),
                attribute("quantity", .decimalAttributeType), attribute("purchasePriceMinorUnits", .integer64AttributeType),
                attribute("currencyCode", .stringAttributeType), attribute("snapshotDate", .dateAttributeType)
            ]),
            entity("MarketPriceSnapshot", fields: [
                attribute("id", .UUIDAttributeType, optional: false), attribute("ownerID", .UUIDAttributeType, optional: false),
                attribute("symbol", .stringAttributeType), attribute("priceMinorUnits", .integer64AttributeType),
                attribute("currencyCode", .stringAttributeType), attribute("observedAt", .dateAttributeType),
                attribute("source", .stringAttributeType), attribute("isStale", .booleanAttributeType)
            ]),
            entity("CurrencyRateSnapshot", fields: [
                attribute("id", .UUIDAttributeType, optional: false), attribute("ownerID", .UUIDAttributeType, optional: false),
                attribute("baseCurrency", .stringAttributeType), attribute("quoteCurrency", .stringAttributeType),
                attribute("rate", .decimalAttributeType), attribute("observedAt", .dateAttributeType),
                attribute("source", .stringAttributeType), attribute("isStale", .booleanAttributeType)
            ]),
            entity("PensionPot", fields: [
                attribute("id", .UUIDAttributeType, optional: false), attribute("ownerID", .UUIDAttributeType, optional: false),
                attribute("name", .stringAttributeType), attribute("provider", .stringAttributeType),
                attribute("schemeType", .stringAttributeType), attribute("validFrom", .dateAttributeType),
                attribute("validTo", .dateAttributeType, optional: true), attribute("currentFlag", .booleanAttributeType)
            ]),
            entity("PensionValuationSnapshot", fields: [
                attribute("id", .UUIDAttributeType, optional: false), attribute("ownerID", .UUIDAttributeType, optional: false),
                attribute("potID", .UUIDAttributeType, optional: false), attribute("date", .dateAttributeType),
                attribute("amountMinorUnits", .integer64AttributeType), attribute("currencyCode", .stringAttributeType)
            ])
        ]
        return model
    }

    private static func entity(_ name: String, fields: [NSAttributeDescription]) -> NSEntityDescription {
        let entity = NSEntityDescription()
        entity.name = name
        entity.managedObjectClassName = "NSManagedObject"
        entity.properties = fields
        return entity
    }

    private static func attribute(_ name: String, _ type: NSAttributeType, optional: Bool = true) -> NSAttributeDescription {
        let attribute = NSAttributeDescription()
        attribute.name = name
        attribute.attributeType = type
        attribute.isOptional = optional
        return attribute
    }
}