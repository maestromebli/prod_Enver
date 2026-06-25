using AssetManagement.Core.Models;
using MediatR;

namespace AssetManagement.Core.Queries;

public record GetAssetStatusByTenantQuery : IRequest<Dictionary<Guid, List<AssetSummary>>>;
