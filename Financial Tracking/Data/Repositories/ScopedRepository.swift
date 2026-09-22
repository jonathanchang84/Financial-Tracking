import Foundation

protocol ScopedRepository {
    associatedtype Entity
    var scope: OwnerScope { get }
    func belongsToScope(_ entity: Entity) -> Bool
}

extension ScopedRepository {
    func requireOwnership(of entity: Entity) throws {
        guard belongsToScope(entity) else { throw RepositoryError.ownerScopeViolation }
    }
}

enum RepositoryError: LocalizedError {
    case ownerScopeViolation
    case duplicateCurrentVersion

    var errorDescription: String? {
        switch self {
        case .ownerScopeViolation: return "The record does not belong to the active owner scope."
        case .duplicateCurrentVersion: return "Only one current SCD version may exist for a logical record."
        }
    }
}