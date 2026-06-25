using AssetManagement.Core.Interfaces;
using AssetManagement.Core.Models;
using AssetManagement.Core.Queries;
using MediatR;

namespace AssetManagement.Core.Handlers;

public class GetAssetStatusByTenantQueryHandler
    : IRequestHandler<GetAssetStatusByTenantQuery, Dictionary<Guid, List<AssetSummary>>>
{
    private readonly IAssetRepository _repository;

    public GetAssetStatusByTenantQueryHandler(IAssetRepository repository) => _repository = repository;

    public Task<Dictionary<Guid, List<AssetSummary>>> Handle(
        GetAssetStatusByTenantQuery request,
        CancellationToken cancellationToken) =>
        _repository.GetAssetStatusByTenantAsync(cancellationToken);
}
