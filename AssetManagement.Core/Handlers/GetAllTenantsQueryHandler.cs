using AssetManagement.Core.Interfaces;
using AssetManagement.Core.Models;
using AssetManagement.Core.Queries;
using MediatR;

namespace AssetManagement.Core.Handlers;

public class GetAllTenantsQueryHandler : IRequestHandler<GetAllTenantsQuery, List<TenantSummary>>
{
    private readonly IAssetRepository _repository;

    public GetAllTenantsQueryHandler(IAssetRepository repository) => _repository = repository;

    public Task<List<TenantSummary>> Handle(GetAllTenantsQuery request, CancellationToken cancellationToken) =>
        _repository.GetAllTenantsAsync(cancellationToken);
}
